import express from "express";
import orderRoutes from "./routes/orderRoutes.js";
import cors from "cors";
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", orderRoutes);

export default app;
