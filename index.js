import fetch from "node-fetch";

export default async function handler(req, res) {
  // Thêm header CORS cho mọi domain (hoặc giới hạn domain của bạn)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Xử lý preflight request (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { trackId } = req.query;
  if (!trackId) {
    return res.status(400).send("❌ Missing trackId parameter.");
  }

  try {
    const targetUrl = `https://www.canvasdownloader.com/canvas?link=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F${trackId}`;
    const response = await fetch(targetUrl);
    const html = await response.text();

    const match = html.match(/https:\/\/canvaz\.scdn\.co\/upload\/artist[^\s"']+/);

    if (match && match[0]) {
      const canvasLink = match[0];
      // Gửi link về dạng JSON để frontend dùng dễ hơn
      return res.status(200).json({ canvas: canvasLink });
    } else {
      return res.status(404).send("❌ Canvas link not found for this trackId.");
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("❌ Server error.");
  }
}
