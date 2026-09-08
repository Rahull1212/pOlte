import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true keeps the parsed JSON body AND exposes the raw request
  // buffer (req.rawBody) alongside it — needed by FyxoAgentWebhookController
  // to verify Fyxo's HMAC-SHA256 signature over the exact bytes Fyxo signed,
  // without having to bypass JSON parsing for every other route.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false, rawBody: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  // Serves WhatsApp media downloads (uploads/*) — a stand-in for real object
  // storage (S3/Cloudinary) until that's built. Not under the /api prefix,
  // so files are reachable at e.g. http://localhost:4000/uploads/xyz.jpg.
  app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads" });

  app.setGlobalPrefix("api");

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`PoliOS API listening on http://localhost:${port}/api`);
}

bootstrap();
