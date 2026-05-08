import express from "express";
import cors from "cors";
import orderRoutes from "./routes/orderRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import pixelRoutes from "./routes/pixelRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", orderRoutes);
app.use("/api", settingRoutes);
app.use("/api", pixelRoutes);
app.use("/api", whatsappRoutes);

export default app;
