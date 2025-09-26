import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { nanoid } from "nanoid";

dotenv.config();
const app = express();
app.use(express.json());

const EASY = "https://easybargainloader.xyz/api";

app.get("/", (req, res) => {
  res.send("FBS Backend is running 🚀");
});

// Example: EasyBargain info
app.get("/api/info", async (req, res) => {
  try {
    const { url } = req.query;
    const { data } = await axios.get(`${EASY}/info/`, { params: { url } });
    res.json(data);
  } catch (err) {
    res.status(500).json({ status: false, error: "info failed" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
