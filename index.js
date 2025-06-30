// v1.2.0 gr8r-airtable-worker
// - FIXED: Removes any fields with empty string values before submitting to Airtable (esp. dates)
// - RETAINED: Title-based create/update logic, verbose error logging, Grafana logging
// - RETAINED: Full record return, direct env access, structured Grafana logs
// v1.1.9 gr8r-airtable-worker
// ADDED: Return full record fields in response for create/update operations (v1.1.9)
// RETAINED: Title-based create/update logic, verbose error logging, Grafana logging (v1.1.9)
// - ADDED verbose error logging (stack trace + payload) to all unhandled exceptions
// - LOGS full Airtable API error bodies and response status codes on failure
// - RETAINED: direct env access to AIRTABLE_TOKEN and AIRTABLE_BASE_ID
// - RETAINED: full validation, structured Grafana logging, and create/update logic

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/airtable/update" && request.method === "POST") {
      let body = null;
      try {
        body = await request.json();
        const { table, title, fields } = body;

        if (!table || !title || !fields || typeof fields !== "object") {
          await logToGrafana(env, "error", "Missing or invalid payload fields", {
            table, title, source: "gr8r-airtable-worker", service: "validation"
          });
          return new Response("Missing or invalid payload fields", { status: 400 });
        }

        const allowedTables = ["Video posts", "Subscribers"];
        if (!allowedTables.includes(table)) {
          await logToGrafana(env, "error", "Invalid table name", {
            table, title, source: "gr8r-airtable-worker", service: "validation"
          });
          return new Response("Invalid table", { status: 403 });
        }

        const airtableToken = env.AIRTABLE_TOKEN;
        const airtableBaseId = env.AIRTABLE_BASE_ID;

        if (!airtableToken || !airtableBaseId) {
          const missing = [
            !airtableToken ? "AIRTABLE_TOKEN" : null,
            !airtableBaseId ? "AIRTABLE_BASE_ID" : null
          ].filter(Boolean).join(", ");

          await logToGrafana(env, "error", "Missing required secrets", {
            missing, source: "gr8r-airtable-worker", service: "secrets"
          });

          return new Response(`Missing required secret(s): ${missing}`, { status: 500 });
        }

        // Remove any empty string fields to avoid Airtable parse errors
        const cleanedFields = Object.fromEntries(
          Object.entries(fields).filter(([_, value]) => value !== "")
        );

        const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${table}`;
        const queryUrl = `${airtableUrl}?filterByFormula=${encodeURIComponent(`{Title} = "${title}"`)}`;

        const response = await fetch(queryUrl, {
          headers: {
            Authorization: `Bearer ${airtableToken}`,
            "Content-Type": "application/json"
          }
        });
        const searchResult = await response.json();

        if (!response.ok) {
          await logToGrafana(env, "error", "Airtable search failed", {
            status: response.status,
            responseBody: searchResult,
            table, title, source: "gr8r-airtable-worker", service: "airtable-search"
          });
          return new Response("Airtable search failed", { status: 500 });
        }

        let recordId;
        let operation;
        let recordData;

        if (searchResult.records.length === 0) {
          const createResponse = await fetch(airtableUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${airtableToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              records: [{ fields: { Title: title, ...cleanedFields } }]
            })
          });
          const createMetadata = await createResponse.json();

          if (!createResponse.ok) {
            await logToGrafana(env, "error", "Airtable create failed", {
              status: createResponse.status,
              responseBody: createMetadata,
              table, title, source: "gr8r-airtable-worker", service: "airtable-create"
            });
            return new Response("Airtable create failed", { status: 500 });
          }

          recordId = createMetadata.records[0].id;
          recordData = createMetadata.records[0].fields;
          operation = "create";
        } else {
          recordId = searchResult.records[0].id;
          const updateResponse = await fetch(`${airtableUrl}/${recordId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${airtableToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields: cleanedFields })
          });

          const updateMetadata = await updateResponse.json();

          if (!updateResponse.ok) {
            await logToGrafana(env, "error", "Airtable update failed", {
              status: updateResponse.status,
              responseBody: updateMetadata,
              table, title, source: "gr8r-airtable-worker", service: "airtable-update"
            });
            return new Response("Airtable update failed", { status: 500 });
          }

          recordData = updateMetadata.fields;
          operation = "update";
        }

        await logToGrafana(env, "info", `Airtable ${operation} successful`, {
          table, title, operation,
          source: "gr8r-airtable-worker", service: `airtable-${operation}`
        });

        return new Response(JSON.stringify({ success: true, recordId, fields: recordData }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        await logToGrafana(env, "error", "Unexpected Airtable worker error", {
          error: err.message,
          stack: err.stack,
          originalPayload: body,
          source: "gr8r-airtable-worker", service: "unhandled"
        });
        return new Response(`Unexpected error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

async function logToGrafana(env, level, message, meta = {}) {
  const payload = {
    level,
    message,
    meta: {
      source: meta.source || "gr8r-airtable-worker",
      service: meta.service || "gr8r-unknown",
      ...meta
    }
  };

  try {
    const res = await env.GRAFANA_WORKER.fetch("https://api.gr8r.com/api/grafana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resText = await res.text();
    console.log("📤 Sent to Grafana:", JSON.stringify(payload));
    console.log("📨 Grafana response:", res.status, resText);

    if (!res.ok) {
      throw new Error(`Grafana log failed: ${res.status} - ${resText}`);
    }
  } catch (err) {
    console.error("📋 Logger failed:", err.message, "📤 Original payload:", payload);
  }
}
