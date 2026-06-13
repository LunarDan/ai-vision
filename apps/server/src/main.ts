import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";
import { ConversationHistoryService } from "./modules/conversation/conversation-history.service.js";
import { OpenaiService } from "./modules/openai/openai.service.js";
import { attachOmniWebSocketProxy } from "./modules/omni/omni-ws.js";

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

  app.enableCors({ origin: webOrigin, credentials: true });
  app.setGlobalPrefix("api");

  const port = Number(process.env.PORT ?? 3001);
  const server = await app.listen(port);
  attachOmniWebSocketProxy(
    server,
    app.get(OpenaiService),
    app.get(ConversationHistoryService),
  );
};

void bootstrap();
