// v1.0.0 gr8r-airtable-worker: handles Airtable record creation and updates via API
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/airtable/update" && request.method === "POST") {
      try {
        const body = await request.json();
        const { title, fields } = body;

        if (!title || !fields || typeof fields !== "object") {
          return new Response("Missing or invalid payload fields", { status: 400 });
        }

        const response = await fetch(
          `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}?filterByFormula=${encodeURIComponent(`{Title} = "${title}"`)}`,
          {
            headers: {
              Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );
        const { records } = await response.json();

        let recordId;
        if (records.length === 0) {
          // Create new record
          const createResponse = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`, {
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
            return new Response(`Create failed: ${createResult.error?.message}`, { status: 500 });
          }
          recordId = createResult.records[0].id;
        } else {
          // Update existing record
          recordId = records[0].id;
          const updateResponse = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}/${recordId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ fields })
          });
          if (!updateResponse.ok) {
            const errorDetails = await updateResponse.text();
            return new Response(`Update failed: ${errorDetails}`, { status: 500 });
          }
        }

        return new Response(JSON.stringify({ success: true, recordId }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(`Unexpected error: ${err.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
