# Studiums-Simulator – statischer Webserver (deploy/server.mjs, ohne Abhängigkeiten)
#   docker compose up -d --build      (siehe docs/HOSTING.md)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=2223 \
    HOST=0.0.0.0

# Nur das, was das Spiel braucht – kein .git, keine Tests, keine Doku
COPY deploy/server.mjs deploy/server.mjs
COPY index.html favicon.svg og-image.png ./
COPY css css
COPY src src
COPY vendor vendor

USER node
EXPOSE 2223

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2223) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "deploy/server.mjs"]
