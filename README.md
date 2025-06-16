# gr8r-airtable-worker
worker for handling airtable queries and updates - modular design attempt
✅ Your Airtable logic is now extracted into a dedicated Worker named gr8r-airtable-worker, routed at:

It accepts inputs like the below:

https://api.gr8r.com/api/airtable/update
It accepts a POST with JSON like:

json
Copy
Edit
{
  "title": "Test Video",
  "fields": {
    "Schedule Date-Time": "2025-06-13T09:00:00",
    "Video Type": "Other",
    "R2 URL": "https://videos.gr8r.com/uploads/..."
  }
}
