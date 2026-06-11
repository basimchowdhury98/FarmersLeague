FROM node:24-alpine AS web-build
WORKDIR /app/src/farmersleague.web
COPY src/farmersleague.web/package*.json ./
RUN npm ci
COPY src/farmersleague.web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /app
COPY src/FarmersLeague.Api/FarmersLeague.Api.csproj src/FarmersLeague.Api/
RUN dotnet restore src/FarmersLeague.Api/FarmersLeague.Api.csproj
COPY src/FarmersLeague.Api/ src/FarmersLeague.Api/
RUN dotnet publish src/FarmersLeague.Api/FarmersLeague.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS mock-build
WORKDIR /app
COPY src/FarmersLeague.MockFootballApi/FarmersLeague.MockFootballApi.csproj src/FarmersLeague.MockFootballApi/
RUN dotnet restore src/FarmersLeague.MockFootballApi/FarmersLeague.MockFootballApi.csproj
COPY src/FarmersLeague.MockFootballApi/ src/FarmersLeague.MockFootballApi/
RUN dotnet publish src/FarmersLeague.MockFootballApi/FarmersLeague.MockFootballApi.csproj -c Release -o /app/mock-publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS mock-runtime
WORKDIR /app
COPY --from=mock-build /app/mock-publish ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "FarmersLeague.MockFootballApi.dll"]

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS app-base
WORKDIR /app
COPY --from=api-build /app/publish ./
COPY --from=web-build /app/src/farmersleague.web/dist/farmersleague.web/browser ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "FarmersLeague.Api.dll"]

FROM app-base AS test
ENV MatchProvider__Name=Mock
ENV FootballApi__BaseUrl=http://mock-football-api:8080

FROM app-base AS prod
ENV MatchProvider__Name=SofaScore
