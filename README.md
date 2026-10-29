# Ferretería AI — Inventario con asistente de IA local

Aplicación web para administrar el inventario de una ferretería (una sola bodega) según `01_Requisitos_ERS.md` y
`02_Analisis_y_Diseño.md`, con un asistente que consulta datos reales mediante herramientas controladas por el backend
y un modelo local ejecutado con **Ollama**.

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 14+ (probado en 18), migraciones SQL versionadas, funciones y triggers de negocio |
| Backend | Node.js 20, Express, TypeScript, `pg`, Zod, JWT + refresh rotado, bcrypt, Helmet, CORS, rate limiting, OpenAPI |
| Frontend | React 18 + TypeScript, Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind, Lucide, componentes estilo shadcn/ui |
| IA | Ollama (API `/api/chat` con *tool calling*), modelo configurable por `.env` |
| Pruebas | Vitest + Supertest (backend, BD real aislada), Vitest + React Testing Library (frontend) |

> PostgreSQL es la única fuente de verdad. El modelo nunca calcula existencias, precios ni totales: los pide al backend.

## Estructura

```
ferreteria-ai/
├── backend/            API Express (src/modules/<módulo>/{routes,service,repository,schemas})
│   ├── migrations/     001 esquema base (doc 04) · 002 correcciones · 003 fichas, cotizaciones, IA, importación
│   ├── seeds/          001 roles y permisos · 002 datos de demostración (incluye el seed original)
│   ├── scripts/db.ts   migrate | seed | reset | verify
│   └── tests/          unit/ e integration/ (84 pruebas)
├── frontend/           React (src/pages, features, components, layouts, lib) + tests/ (13 pruebas)
├── docs/               arquitectura, base de datos, API, agente IA, cotizaciones, seguridad, decisiones pendientes
└── docker-compose.yml
```

## Instalación desde cero

Requisitos: Node.js 20+, PostgreSQL 14+ y (para el asistente) Ollama.

```bash
# 1. Bases de datos (desarrollo y pruebas)
psql -U postgres -c "CREATE DATABASE ferreteria_ai" -c "CREATE DATABASE ferreteria_ai_test"

# 2. Backend
cd backend
cp .env.example .env          # edite DATABASE_URL, TEST_DATABASE_URL y JWT_SECRET
npm install
npm run db:migrate            # aplica migrations/ desde una base vacía
npm run db:seed               # roles, permisos y datos de demostración
npm run db:verify             # comprueba kardex = existencias y lotes = total físico
npm run dev                   # http://localhost:4000/api  · documentación: http://localhost:4000/api/docs

# 3. Frontend (otra terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 (el proxy de Vite envía /api al backend)
```

`npm run db:reset` borra y recrea todo el esquema (deshabilitado con `NODE_ENV=production`).

### Usuarios de demostración

Contraseña de prueba para todos: `ClaveSegura1` (definida en `seeds/002_demo.sql`; cámbiela o elimine estos usuarios fuera de la demo).

| Correo | Rol |
|---|---|
| ana@ferreteria.test | Administrador |
| ivan@ferreteria.test | Inventario |
| camila@ferreteria.test | Compras |
| valentina@ferreteria.test | Ventas |
| gabriel@ferreteria.test | Gerencia |
| iris@ferreteria.test | Ventas (inactiva: no puede iniciar sesión) |

## Ollama (modelo local)

1. Instale Ollama: <https://ollama.com/download> (Windows, macOS o Linux).
2. Inicie el servicio: `ollama serve` (en Windows queda como servicio tras instalarlo).
3. Descargue un modelo con soporte de herramientas, por ejemplo: `ollama pull qwen2.5:7b` (≈4,7 GB; requiere ~8 GB de RAM libre).
   Alternativas: `llama3.1:8b`, `qwen2.5:14b` (mejor razonamiento, más recursos), `qwen2.5:3b` (equipos modestos, menor calidad).
4. Ajuste `OLLAMA_MODEL` y `OLLAMA_BASE_URL` en `backend/.env`.
5. Compruebe: pantalla **Estado de Ollama** en la aplicación o `GET /api/ai/status` (indica conectividad y si el modelo está instalado o descargándose).

El uso del modelo local no tiene costo por llamada, pero sí costos de infraestructura (hardware, energía, alojamiento).

## Pruebas

```bash
cd backend && npm test     # 84 pruebas: reglas PB-01…PB-18 en PostgreSQL, API, concurrencia, cotizador y agente
cd frontend && npm test    # 13 pruebas: formularios, estados, permisos, flujo del asistente y cotizaciones
```

Las pruebas del backend recrean `TEST_DATABASE_URL` en cada ejecución (nunca tocan la base de desarrollo). Las del
agente usan un LLM simulado que reproduce el protocolo `tool_calls` de Ollama: se verifican herramientas, permisos y
cálculos, no el texto generado.

## Docker

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build   # frontend en http://localhost:8080
docker compose exec backend node dist/scripts/db.js seed          # datos de demostración (opcional)
docker compose --profile ia up -d && docker compose exec ollama ollama pull qwen2.5:7b
```

## Documentación

- [docs/arquitectura.md](docs/arquitectura.md) — capas, módulos y matriz requisito → tablas → endpoints → pruebas.
- [docs/base-de-datos.md](docs/base-de-datos.md) — migraciones, correcciones al SQL original, invariantes.
- [docs/api.md](docs/api.md) — convenciones, endpoints y plantillas de importación (OpenAPI en `/api/docs`).
- [docs/agente-ia.md](docs/agente-ia.md) — herramientas, ciclo del agente, límites y verificación de cifras.
- [docs/cotizaciones.md](docs/cotizaciones.md) — fórmulas y reglas del cotizador de pintura.
- [docs/seguridad.md](docs/seguridad.md) — autenticación, permisos y controles del asistente.
- [docs/decisiones-pendientes.md](docs/decisiones-pendientes.md) — supuestos provisionales, inconsistencias y limitaciones.
