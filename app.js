import express from "express";
import orderRoutes from "./routes/orderRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import cors from "cors";
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", orderRoutes);
app.use("/api", settingRoutes);

export default app;
