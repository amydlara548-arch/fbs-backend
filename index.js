import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { nanoid } from "nanoid";

dotenv.config();
const app = express();
app.use(express.json());

const EASY = "https://easybargainloader.xyz/api";

// -----------------------------
// Dropbox upload helper
// -----------------------------
async function uploadToDropbox(buffer, filename) {
  const token = process.env.DROPBOX_TOKEN;

  const up = await axios.post(
    "https://content.dropboxapi.com/2/files/upload",
    buffer,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: `/${filename}`,
          mode: "add",
          autorename: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const shared = await axios.post(
    "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
    { path: up.data.path_lower },
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return shared.data.url.replace("?dl=0", "?dl=1");
}

// -----------------------------
// Routes
// -----------------------------
app.get("/", (req, res) => {
  res.send("FBS Backend is running 🚀");
});

// ✅ Get file info
app.get("/api/info", async (req, res) => {
  try {
    const { url } = req.query;
    const { data } = await axios.get(`${EASY}/info/`, { params: { url } });
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: false, error: "info failed" });
  }
});

// ✅ Place order
app.post("/api/order", async (req, res) => {
  try {
    const { user_id, url, source } = req.body;

    // 1) User check
    const users = await axios.get(process.env.SHEET_USERS);
    const user = users.data.find((u) => u.id === user_id);
    if (!user) return res.status(400).json({ error: "User not found" });

    // 2) Place order at EasyBargain
    const orderRes = await axios.get(`${EASY}/order/`, {
      params: { key: process.env.EASYBARGAIN_API_KEY, url, source },
    });
    const task_id = orderRes.data.result.task_id;

    const orderId = `ord_${nanoid(6)}`;

    // Save order initially
    await axios.post(process.env.SHEET_ORDERS, [
      {
        id: orderId,
        user_id,
        url,
        source,
        task_id,
        status: "processing",
        created_at: new Date().toISOString(),
      },
    ]);

    // 3) Poll until ready
    let ready = null;
    for (let i = 0; i < 25; i++) {
      const dl = await axios.get(`${EASY}/download/`, {
        params: { key: process.env.EASYBARGAIN_API_KEY, task_id },
      });
      if (dl.data.result?.ready) {
        ready = dl.data.result;
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!ready) {
      return res
        .status(500)
        .json({ status: false, error: "File not ready in time" });
    }

    // 4) Download file from EasyBargain
    const fileResp = await axios.get(ready.download, {
      responseType: "arraybuffer",
    });

    // 5) Upload to Dropbox
    const dropboxLink = await uploadToDropbox(fileResp.data, ready.filename);

    // 6) Update orders sheet
    await axios.patch(`${process.env.SHEET_ORDERS}/id/${orderId}`, [
      {
        status: "ready",
        filename: ready.filename,
        dropbox_link: dropboxLink,
        updated_at: new Date().toISOString(),
      },
    ]);

    // 7) Deduct credits from user
    const newCredits = (parseFloat(user.credits) - 5).toString();
    await axios.patch(`${process.env.SHEET_USERS}/id/${user.id}`, [
      { credits: newCredits },
    ]);

    res.json({
      status: true,
      order_id: orderId,
      link: dropboxLink,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ status: false, error: "Order failed" });
  }
});

// -----------------------------
// Start server
// -----------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
