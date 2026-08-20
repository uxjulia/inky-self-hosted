FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_INKY_APP_MODE=self-hosted
ENV VITE_INKY_APP_MODE=$VITE_INKY_APP_MODE
ARG VITE_INKY_DICTIONARY_TOOLS=0
ENV VITE_INKY_DICTIONARY_TOOLS=$VITE_INKY_DICTIONARY_TOOLS
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
