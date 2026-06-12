import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      service: "ai-vision-server",
      timestamp: new Date().toISOString(),
    };
  }
}
