# PremiumPricingAPI

Backend repo 3. Calculates the final insurance premium.

Run:

```powershell
node server.js
```

Default endpoint:

```text
POST http://localhost:4003/api/premium-pricing
```

Logs:

- `api_logs`: inbound pricing requests
- `third_party_api_logs`: present for consistency; this service does not call another backend in the pipeline
