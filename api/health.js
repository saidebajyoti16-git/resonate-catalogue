export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.status(200).json({
    ok: true,
    service: "resonate-catalogue",
    timestamp: new Date().toISOString(),
  });
}
