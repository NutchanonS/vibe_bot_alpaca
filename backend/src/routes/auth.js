const router = require("express").Router();
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth");

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "changeme";

router.post("/login", (req, res) => {
  const { password } = req.body;
  if (!password || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = jwt.sign({ role: "trader" }, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token });
});

module.exports = router;
