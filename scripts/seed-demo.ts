import { localPlatform } from "./local";
import { seedCatalog } from "../src/db/seed";
const { proxy, env } = await localPlatform();
try {
  await seedCatalog(env.DB);
  console.log(
    "Version 1 package catalog seeded. No client accounts or credentials were created.",
  );
} finally {
  await proxy.dispose();
}
