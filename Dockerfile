FROM node:22-alpine AS web-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
ARG VITE_INKY_APP_MODE=self-hosted
ENV VITE_INKY_APP_MODE=$VITE_INKY_APP_MODE
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx gettext-base libxml2 libxslt1.1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app ./backend/app
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
COPY deploy/railway-nginx.conf.template /etc/nginx/templates/railway.conf.template
COPY scripts/start-railway.sh ./scripts/start-railway.sh

ENV INKY_DATA_DIR=/data
ENV INKY_DATABASE_URL=sqlite:////data/inky.db
ENV PORT=8080

EXPOSE 8080

CMD ["sh", "scripts/start-railway.sh"]
