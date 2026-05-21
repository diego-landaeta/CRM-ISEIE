# Database - Registro de Ejecuciones

Historial de todas las migraciones, seeds y cambios aplicados a las bases de datos del CRM.

## Bases de datos

| DB | Uso | Servidor |
|----|-----|----------|
| **crm_db** | Produccion | 187.124.128.126:5432 |
| **crm_test_db** | Staging / Testing | 187.124.128.126:5432 |

## Estructura

```
database/
  README.md            # Este archivo
  fase-1/              # Migraciones y seeds de Fase 1 (Core CRM)
  fase-2/              # Migraciones de Fase 2 (APIs externas)
  fase-3/              # Migraciones de Fase 3 (Funcionalidades avanzadas)
```

## Convenciones

- Cada ejecucion se documenta con fecha, DB objetivo, resultado y observaciones
- Los archivos SQL fuente estan en `backend/migrations/` y `backend/seeds/`
- Nunca ejecutar migraciones de produccion sin probar primero en crm_test_db
