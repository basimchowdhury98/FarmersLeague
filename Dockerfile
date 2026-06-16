FROM node:24-alpine AS web-build
WORKDIR /app/src/farmersleague.web
COPY src/farmersleague.web/package*.json ./
RUN npm ci
COPY src/farmersleague.web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /app
COPY src/FarmersLeague.Api/FarmersLeague.Api.csproj src/FarmersLeague.Api/
COPY src/FarmersLeague.Scraper/FarmersLeague.Scraper.csproj src/FarmersLeague.Scraper/
RUN dotnet restore src/FarmersLeague.Api/FarmersLeague.Api.csproj
COPY src/FarmersLeague.Api/ src/FarmersLeague.Api/
COPY src/FarmersLeague.Scraper/ src/FarmersLeague.Scraper/
RUN dotnet publish src/FarmersLeague.Api/FarmersLeague.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS app
WORKDIR /app
COPY --from=api-build /app/publish ./
COPY --from=web-build /app/src/farmersleague.web/dist/farmersleague.web/browser ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "FarmersLeague.Api.dll"]
