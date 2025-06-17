// v1.0.7 gr8r-airtable-worker: adds inline logging to debug Grafana push
//REPLACED `logToGrafana` with verbose version including payload + response logging
//ADDED console.log for payload send and response status for transparency
//NOTED optional rethrow pattern for future log visibility during silent failures
//MAINTAINED label consistency for `source` and `service` across all logs

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/airtable/update" && request.method === "POST") {
      try {
        const body = await request.json();
        const { table, title, fields } = body;

        if (!table || !title || !fields || typeof fields !== "object") {
          await logToGrafana("error", "Missing or invalid payload fields", {
            table, title, source: "gr8r-airtable-worker", service: "validation"
          });
          return new Response("Missing or invalid payload fields", { status: 400 });
        }

        const allowedTables = ["Video posts", "Subscribers"];
        if (!allowedTables.includes(table)) {
          await logToGrafana("error", "Invalid table name", {
            table, title, source: "gr8r-airtable-worker", service: "validation"
          });
          return new Response("Invalid table", { status: 403 });
        }

        const airtableUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}`;
        const queryUrl = `${airtableUrl}?filterByFormula=${encodeURIComponent(`{Title} = "${title}"`)}`;

        const response = await fetch(queryUrl, {
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json"
          }
        });
        const { records } = await response.json();

        let recordId;
        let operation;

        if (records.length === 0) {
          const createResponse = await fetch(airtableUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              records: [{ fields: { Title: title, ...fields } }]
            })
          });
          const createResult = await createResponse.json();

          if (!createResponse.ok) {
            const rawError = typeof createResult.error === "string"
              ? createResult.error
              : createResult.error?.message || JSON.stringify(createResult.error);

            await logToGrafana("error", "Airtable create failed", {
              table, title, error: rawError,
              source: "gr8r-airtable-worker", service: "airtable-create"
            });
            return new Response(`Create failed: ${rawError}`, { status: 500 });
          }

          recordId = createResult.records[0].id;
          operation = "create";
        } else {
          recordId = records[0].id;
          const updateResponse = await fetch(`${airtableUrl}/${recordId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields })
          });

          if (!updateResponse.ok) {
            const errorDetails = await updateResponse.text();
            await logToGrafana("error", "Airtable update failed", {
              table, title, error: errorDetails,
              source: "gr8r-airtable-worker", service: "airtable-update"
            });
            return new Response(`Update failed: ${errorDetails}`, { status: 500 });
          }

          operation = "update";
        }

        await logToGrafana("info", `Airtable ${operation} successful`, {
          table, title, operation,
          source: "gr8r-airtable-worker", service: `airtable-${operation}`
        });

        return new Response(JSON.stringify({ success: true, recordId }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        await logToGrafana("error", "Unexpected Airtable worker error", {
          error: err.message,
          source: "gr8r-airtable-worker", service: "unhandled"
        });
        return new Response(`Unexpected error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

async function logToGrafana(level, message, meta = {}) {
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
    const res = await fetch("https://api.gr8r.com/api/grafana", {
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
    console.error("📛 Logger failed:", err.message, "📤 Original payload:", payload);
  }
}
