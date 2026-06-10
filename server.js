const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4003);

const API_LOG_FILE = path.join(__dirname, "api_logs");
const THIRD_PARTY_LOG_FILE = path.join(__dirname, "third_party_api_logs");
const VALID_ELIGIBILITY_STATUSES = new Set(["ineligible", "manual_review", "eligible"]);

for (const filePath of [API_LOG_FILE, THIRD_PARTY_LOG_FILE]) {
  fs.closeSync(fs.openSync(filePath, "a"));
}

function appendLog(filePath, record) {
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function fullUrl(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}${req.url}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    req.on("data", chunk => {
      rawBody += chunk;
    });

    req.on("end", () => {
      if (!rawBody.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function baseRateForCoverage(type) {
  const rates = {
    health: 0.036,
    life: 0.024,
    motor: 0.041,
    travel: 0.012
  };

  return rates[String(type || "health").toLowerCase()] || rates.health;
}

function calculatePremium(requestData) {
  const riskScore = asNumber(requestData.risk_score, 30);
  const coverage = requestData.coverage || {};
  const applicant = requestData.applicant || {};
  const coverageType = String(coverage.type || "health").toLowerCase();
  const sumInsured = asNumber(coverage.sum_insured, 500000);
  const deductible = asNumber(coverage.deductible, 10000);
  const age = asNumber(applicant.age, 35);

  const baseRate = baseRateForCoverage(coverageType);
  const riskMultiplier = 1 + riskScore / 100;
  const ageMultiplier = age >= 60 ? 1.22 : age >= 45 ? 1.12 : 1;
  const deductibleDiscount = Math.min(deductible / Math.max(sumInsured, 1), 0.08);
  const annualPremium = sumInsured * baseRate * riskMultiplier * ageMultiplier;
  const discountedAnnualPremium = annualPremium * (1 - deductibleDiscount);

  return {
    pricing_id: `price_${crypto.randomUUID().slice(0, 8)}`,
    coverage_type: coverageType,
    currency: "INR",
    sum_insured: roundMoney(sumInsured),
    base_rate: roundMoney(baseRate),
    risk_multiplier: roundMoney(riskMultiplier),
    age_multiplier: roundMoney(ageMultiplier),
    deductible_discount: roundMoney(deductibleDiscount),
    annual_premium: roundMoney(discountedAnnualPremium),
    monthly_premium: roundMoney(discountedAnnualPremium / 12)
  };
}

async function handlePremiumPricing(req, res) {
  let requestData = {};
  let responseData = {};
  let statusCode = 200;

  try {
    requestData = await readJsonBody(req);
    if (!requestData.eligibility_status || !VALID_ELIGIBILITY_STATUSES.has(String(requestData.eligibility_status))) {
      throw new Error("Not valid JSON. eligibility_status is required and must be one of the required values.");
    }
    const eligibilityStatus = requestData.eligibility_status
      .trim()
      .toLowerCase();

    if (eligibilityStatus === "ineligible") {
      statusCode = 422;
      responseData = {
        application_id: requestData.application_id,
        status: "premium_blocked",
        message: "Premium cannot be generated for ineligible applicants.",
        eligibility_status: eligibilityStatus
      };
    } else {
      responseData = {
        application_id: requestData.application_id,
        status: "premium_priced",
        ...calculatePremium(requestData)
      };
    }
  } catch (error) {
    statusCode = error.message.includes("valid JSON") ? 400 : 500;
    responseData = {
      status: "error",
      message: error.message
    };
  }

  appendLog(API_LOG_FILE, {
    url: fullUrl(req),
    request_data: requestData,
    response_data: responseData
  });

  sendJson(res, statusCode, responseData);
}

function handleHealth(req, res) {
  const responseData = {
    service: "PremiumPricingAPI",
    status: "ok",
    downstream_api: null
  };

  appendLog(API_LOG_FILE, {
    url: fullUrl(req),
    request_data: {},
    response_data: responseData
  });

  sendJson(res, 200, responseData);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    handleHealth(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/premium-pricing") {
    handlePremiumPricing(req, res);
    return;
  }

  sendJson(res, 404, {
    status: "not_found",
    message: "Use POST /api/premium-pricing."
  });
});

server.listen(PORT, () => {
  console.log(`PremiumPricingAPI running on http://localhost:${PORT}`);
});
