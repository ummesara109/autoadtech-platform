/**
 * Full Fastify e2e needs Jest ESM transform for @nestjs/config.
 * Gate coverage is exercised via unit tests + manual/dev smoke
 * (see cms/README.md). CI runs `npm run build` for api + web.
 */
describe('CMS API (e2e)', () => {
  it.todo('lookup → verify → dashboard against Fastify adapter');
});
