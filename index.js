// v1.0.3 gr8r-airtable-worker: improves Grafana log visibility
//UPDATED logToGrafana() to enforce consistent meta.source and meta.service labels
//ADDED defaults for `source` as "gr8r-airtable-worker" and `service` as "gr8r-unknown"
//ENSURES logs always appear in Grafana Loki when fallback labels are needed

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/airtable/update" && request.method === "POST") {
      try {
        const body = await request.json();
        const { table, title, fields } = body;

        if (!table || !title || !fields || typeof fields !== "object") {
          return new Response("Missing or invalid payload fields", { status: 400 });
        }

        const allowedTables = ["Video posts", "Subscribers"];
        if (!allowedTables.includes(table)) {
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
          // Create new record
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
            await logToGrafana("error", "Airtable create failed", { table, title, error: createResult.error?.message });
            return new Response(`Create failed: ${createResult.error?.message}`, { status: 500 });
          }

          recordId = createResult.records[0].id;
          operation = "create";
        } else {
          // Update existing record
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
            await logToGrafana("error", "Airtable update failed", { table, title, error: errorDetails });
            return new Response(`Update failed: ${errorDetails}`, { status: 500 });
          }

          operation = "update";
        }

        await logToGrafana("info", `Airtable ${operation} successful`, { table, title, operation });

        return new Response(JSON.stringify({ success: true, recordId }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        await logToGrafana("error", "Unexpected Airtable worker error", { error: err.message });
        return new Response(`Unexpected error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

async function logToGrafana(level, message, meta = {}) {
  try {
    const payload = {
      level,
      message,
      meta: {
        source: meta.source || "gr8r-airtable-worker",
        service: meta.service || "gr8r-unknown",
        ...meta
      }
    };

    await fetch("https://api.gr8r.com/api/grafana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error("Logger failed:", err.message);
  }
}



