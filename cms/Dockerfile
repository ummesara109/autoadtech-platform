FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY plugins/niyoads-silent-gps/package.json ./plugins/niyoads-silent-gps/package.json
RUN npm ci

COPY . .
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 4100
CMD ["node", "dist/main.js"]
