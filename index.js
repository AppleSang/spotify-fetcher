import fetch from "node-fetch";

/**
 * API Route for Vercel
 * Usage: https://your-vercel-app.vercel.app/api/canvas?trackId=xxxx
 */
export default async function handler(req, res) {
  const { trackId } = req.query;

  if (!trackId) {
    return res.status(400).send("❌ Missing trackId parameter.");
  }

  try {
    const targetUrl = `https://www.canvasdownloader.com/canvas?link=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F${trackId}`;
    const response = await fetch(targetUrl);
    const html = await response.text();

    // Regex tìm link bắt đầu bằng https://canvaz.scdn.co/upload/artist
    const match = html.match(/https:\/\/canvaz\.scdn\.co\/upload\/artist[^\s"']+/);

    if (match && match[0]) {
      const canvasLink = match[0];
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
