require("dotenv").config();
const axios = require("axios");
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

// =========================
// SERVE STATIC FILES (index.html)
// =========================
app.use(express.static(path.join(__dirname)));

// =========================
// CONFIG - ADD CARDS HERE
// =========================
const CARDS = [
  { name: "charizard ex 151", number: "199/165" },
  { name: "blastoise ex 151", number: "200/165" },
  { name: "venusaur ex 151", number: "198/165" }
];

// =========================
// RATE LIMIT HELPER
// =========================
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =========================
// CONDITION EXTRACTOR
// =========================
function extractCondition(title) {
  const lower = title.toLowerCase();

  if (lower.includes("psa 10") || lower.includes("psa10")) return "PSA 10";
  if (lower.includes("psa 9") || lower.includes("psa9")) return "PSA 9";
  if (lower.includes("psa 8")) return "PSA 8";
  if (lower.includes("bgs")) return "BGS";
  if (lower.includes("cgc")) return "CGC";

  return "RAW";
}

// =========================
// MEDIAN CALCULATOR
// =========================
function getMedian(prices) {
  if (prices.length === 0) return null;

  const sorted = prices.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// =========================
// DATE FILTER - last 30 days
// =========================
function isWithin30Days(dateStr) {
  if (!dateStr) return true; // keep if no date info available
  const sold = new Date(dateStr);
  if (isNaN(sold.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  return sold >= cutoff;
}

// =========================
// GET ACTIVE LISTINGS
// =========================
async function getListings(card) {
  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "ebay",
        ebay_domain: "ebay.ca",
        _nkw: card.name,
        api_key: process.env.SERPAPI_KEY
      }
    });

    const results = response.data.organic_results || [];
    const cleanedListings = [];
    // Normalize card number for matching (lowercase, trimmed)
    const normalizedNumber = card.number.toLowerCase().trim();

    for (const item of results) {
      const title = item.title.toLowerCase();

      if (!title.includes(normalizedNumber)) continue;

      let price =
        item.price?.extracted ||
        item.price?.from?.extracted ||
        (typeof item.price === "number" ? item.price : null);

      if (!price) continue;

      const condition = extractCondition(item.title);
      const thumbnail = item.thumbnail || item.image || null;
      const listingType = (item.type || "").toLowerCase().includes("auction") ? "Auction" : "Buy Now";

      cleanedListings.push({
        title: item.title,
        price: price,
        link: item.link,
        condition: condition,
        thumbnail: thumbnail,
        listingType: listingType
      });
    }

    return cleanedListings;

  } catch (error) {
    console.error(`Active listings error for "${card.name}":`, error.message);
    return [];
  }
}

// =========================
// GET SOLD LISTINGS (30 DAYS)
// =========================
async function getSoldListings(card) {
  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "ebay",
        ebay_domain: "ebay.ca",
        _nkw: card.name,
        sold_items: true,
        api_key: process.env.SERPAPI_KEY
      }
    });

    const results = response.data.organic_results || [];
    const soldPrices = [];
    // Normalize card number for matching (lowercase, trimmed)
    const normalizedNumber = card.number.toLowerCase().trim();

    for (const item of results) {
      const title = item.title.toLowerCase();

      if (!title.includes(normalizedNumber)) continue;

      // Client-side 30-day filter since _trs param is unreliable
      if (!isWithin30Days(item.date)) continue;

      let price =
        item.price?.extracted ||
        item.price?.from?.extracted ||
        (typeof item.price === "number" ? item.price : null);

      if (!price) continue;

      const condition = extractCondition(item.title);

      soldPrices.push({
        price: price,
        condition: condition
      });
    }

    return soldPrices;

  } catch (error) {
    console.error(`Sold listings error for "${card.name}":`, error.message);
    return [];
  }
}

// =========================
// FIND DEALS FUNCTION
// =========================
async function findDeals() {
  const deals = [];

  for (const card of CARDS) {
    console.log(`Checking: ${card.name}...`);

    const activeListings = await getListings(card);

    // Rate limit: wait 500ms between active and sold calls
    await delay(500);

    const soldPrices = await getSoldListings(card);

    // Rate limit: wait 500ms before next card
    await delay(500);

    for (const item of activeListings) {
      const matchingSold = soldPrices.filter(
        s => s.condition === item.condition
      );

      if (matchingSold.length < 3) continue;

      const prices = matchingSold.map(s => s.price);
      const median = getMedian(prices);

      if (!median) continue;

      const discount = (median - item.price) / median;

      if (item.price < 5) continue;

      if (discount >= 0.25) {
        deals.push({
          card: `${card.name} ${card.number}`,
          title: item.title,
          condition: item.condition,
          price: item.price,
          median: median,
          discount: (discount * 100).toFixed(1),
          link: item.link,
          thumbnail: item.thumbnail,
          listingType: item.listingType
        });
      }
    }
  }

  return deals;
}
// =========================
// EBAY DELETION ENDPOINT
// =========================
app.get("/ebay/deletion", (req, res) => {
  const challengeCode = req.query.challenge_code;
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  const endpoint = "https://pokemon-stuff.onrender.com";

  const hash = crypto.createHash("sha256")
    .update(challengeCode + verificationToken + endpoint)
    .digest("hex");

  res.json({ challengeResponse: hash });
});
// =========================
// API ROUTE
// =========================

app.get("/deals", async (req, res) => {
  try {
    console.log("Fetching deals...");
    const deals = await findDeals();
    res.json(deals);
  } catch (err) {
    console.error("Error in /deals:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});