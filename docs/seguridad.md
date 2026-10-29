# Seguridad

## Autenticación (DP-01)

- Contraseñas con bcrypt (coste 12 en altas; el seed usa `crypt(…, gen_salt('bf'))` compatible).
- Token de acceso JWT HS256 de `JWT_EXPIRES_IN` (15 min). Token de renovación aleatorio de 48 bytes, guardado solo como
  hash SHA-256, válido `JWT_REFRESH_DAYS` días, **de un solo uso** (rotación) y revocable con logout o al desactivar el usuario.
- El frontend guarda los tokens en `sessionStorage` (se borran al cerrar la pestaña) y renueva una vez ante un 401.
- Respuesta idéntica para correo inexistente o contraseña incorrecta, con tiempo constante (hash ficticio).
- Sin 2FA ni bloqueo por intentos (por definir); rate limiting en login.

## Autorización

- Permisos por rol en base de datos (`rol_permiso`), verificados en el backend en cada ruta (`requirePermission`).
  El frontend oculta lo no permitido, pero no es la barrera de seguridad.
- Costos y valorización solo con `costo.consultar`; las respuestas y las herramientas del asistente eliminan esos campos.
- Las cotizaciones ajenas responden 404 salvo para roles con reportes/administración.

## Plataforma

Helmet, CORS restringido a `FRONTEND_URL`, límite de cuerpo 200 kB (5 MB para Excel), rate limiting general / login / chat,
consultas siempre parametrizadas, validación Zod de entradas y configuración, errores sin trazas, logs con
redacción de `authorization`, contraseñas y tokens. `.env` excluido de Git.

## Asistente de IA

- Ollama no se publica: solo el backend lo llama. No recibe credenciales ni puede construir SQL.
- El modelo solo ve las herramientas permitidas al usuario; los nombres desconocidos se rechazan.
- Argumentos validados con Zod; claves extra se descartan (p. ej., un `precio_unitario` inventado).
- Los datos de la base se envían como JSON dentro de `{ ok, datos }` y la instrucción de sistema indica tratarlos como
  datos. Textos libres recortados a 200 caracteres. Prueba de inyección en `tests/integration/ai.test.ts`.
- Ninguna herramienta modifica inventario, precios ni documentos; guardar cotizaciones exige confirmación humana.
- Límites de iteraciones, llamadas a herramientas, tamaño de mensaje, historial y tiempo.
- Verificación de cifras: se bloquean respuestas con cantidades no respaldadas cuando una herramienta falla.

## Auditoría

Triggers en todas las tablas relevantes registran usuario (`app.usuario_id`), origen (`online`/`offline`), acción y
valores antes/después. `auditoria`, `cierre_mensual` y su detalle rechazan `UPDATE`, `DELETE` y `TRUNCATE`.
Para endurecer en producción: conectar la aplicación con un rol PostgreSQL sin privilegios de superusuario ni de `ALTER`/`DROP`.
