// www.fandex.org. Its whole job is to send everything to fandex.org, the way
// the old site's next.config.ts did, so one address is the canonical one.
//
//   cd worker && npx wrangler deploy --config ../mobile/web/www/wrangler.jsonc
//
// A Worker of its own because the website's files are served without running
// any code (mobile/web/worker.ts), so there would be nowhere to redirect from.

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.hostname = 'fandex.org';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
