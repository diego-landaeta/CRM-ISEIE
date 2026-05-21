# Multi-instancia — features a la carta al instalar

**Jira:** CRM-197
**Estado:** 📝 Backlog (depende de CRM-178)
**Tipo:** Epic avanzado

## Contexto

Se quiere poder desplegar el MISMO codigo base en distintos servers con distintos sets de features habilitados a nivel de INSTALACION (no solo por proyecto).

**Casos:**
- Server A (cliente grande): todo activo
- Server B (cliente mediano): solo leads + forms + contabilidad
- Server C (plataforma digital): solo platform_users + accounting_income

## Arquitectura 2 capas

```
INSTALL TIME (.env del server)
  └─ ENABLED_MODULES=leads,conversions,commissions
     │ (define que modulos CAN ejecutarse)
     ▼
  RUNTIME (por proyecto, CRM-178)
  └─ projects.modules JSONB { leads: true, commissions: false, ... }
     (define cual se usa de los que el server tiene)
```

**Regla:** un proyecto NO puede activar un modulo que el server no tenga en `ENABLED_MODULES`.

## Cambios necesarios

### Backend

```js
// app.js
const AVAILABLE_MODULES = (process.env.ENABLED_MODULES || 'leads,products,conversions,commissions,accounting,forms,matriculas,woocommerce,payroll,reports,platform_users').split(',');

const ALL_MODULES = {
  leads: leadsModule,
  products: productsModule,
  // ... todos
};

for (const name of AVAILABLE_MODULES) {
  const mod = ALL_MODULES[name];
  if (mod) {
    app.use(mod.prefix, mod.router);
    logger.info(`Modulo instalado: ${mod.prefix}`);
  }
}
```

**Middleware global:**
```js
// Cualquier ruta que no este montada → 404 con code MODULE_NOT_INSTALLED
```

**Endpoint nuevo:**
- `GET /api/system/modules` → retorna `AVAILABLE_MODULES`

### Frontend

- Al login, cachea `availableModules` del `/api/system/modules`
- ProjectSettingsDialog > tab "Modulos" solo muestra modulos en AvailableModules
- Sidebar doble filtro: `(module in available) AND (module in project.modules)`
- Vite build: `VITE_ENABLED_MODULES` permite tree-shake para builds mas pequeños

### DB

- Migraciones corren **todas** siempre (schema completo)
- Tablas de modulos no instalados quedan vacias (no hay ORM stricto)
- No se cae nada por no tener datos

## Ejemplo .env

```bash
# server completo
ENABLED_MODULES=leads,products,conversions,commissions,accounting_income,accounting_expenses,accounting_receivable,accounting_payable,payroll,forms,matriculas,reports,woocommerce,platform_users

# server minimal
ENABLED_MODULES=leads,accounting_income,accounting_expenses,reports
```

## Script de instalacion

```bash
# install.sh
echo "Bienvenido. ¿Que modulos activar?"
select_modules_interactive
write_env ENABLED_MODULES=$selected
run_migrations
pm2_start
```

## Beneficios

- Mismo codigo base, multiples deploys simples
- Licencias diferenciadas posibles (feature premium)
- Menor superficie de ataque en servers minimales
- Pricing por feature si se vende como SaaS

## Relacion con CRM-178

CRM-178 es toggle runtime por proyecto. CRM-197 añade toggle install-time por server. **Se implementan juntos o primero CRM-178 y luego este** (CRM-178 es prerequisito).

## Registry central

Requiere definir en el codigo un registry de modulos con metadata:

```js
// backend/src/shared/registry.js
export const MODULE_REGISTRY = {
  leads: {
    label: 'Leads',
    depends_on: [],
    router: leadsModule,
  },
  commissions: {
    label: 'Comisiones',
    depends_on: ['products', 'conversions'],
    router: commissionsModule,
  },
  // ...
};
```

## AC

- [ ] Instalador pregunta que modulos activar
- [ ] Server con modulos reducidos:
  - Rutas de modulos no instalados dan 404
  - Sidebar no los muestra
  - ProjectSettingsDialog no permite activarlos
- [ ] Puedo mover DB de server completo a minimal → funciona (tablas extra ignoradas)
- [ ] `GET /api/system/modules` refleja lo que el server tiene
