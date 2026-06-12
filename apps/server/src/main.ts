import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

  app.enableCors({ origin: webOrigin, credentials: true });
  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
};

void bootstrap();
