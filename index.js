import fetch from "node-fetch";

export default async function handler(req, res) {
  // Cho phép gọi từ browser (ví dụ từ GitHub Pages)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Nếu là preflight (OPTIONS), trả OK
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

    // Tìm link Canvas thực
    const match = html.match(/https:\/\/canvaz\.scdn\.co\/upload\/artist[^\s"']+/);

    if (match && match[0]) {
      const canvasLink = match[0];
      // Redirect người dùng sang link Canvas
      res.writeHead(302, { Location: canvasLink });
      return res.end();
    } else {
      return res.status(404).send("❌ Canvas link not found for this trackId.");
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("❌ Server error.");
  }
}
