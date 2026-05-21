# Estado Backend vs Frontend - 07/04/2026

## Resumen: 18 features backend listas sin frontend

### AUTH (Backend OK)
- [ ] Frontend no oculta opciones segun rol (gestor ve todo)
- [ ] Activity log no se muestra en ningun lado

### USUARIOS (Backend OK)
- [ ] No se editan proyectos asignados desde el form
- [ ] No hay boton reactivar usuario
- [ ] Formulario crear usuario no muestra checkboxes de proyectos

### LEADS (Backend OK)
- [ ] No hay panel webhook/API key en Settings
- [ ] Filtro por canal y responsable no conectado al backend
- [ ] Buscador no llama al backend (solo visual)
- [ ] Detalle no muestra UTMs, no es editable
- [ ] Interacciones se crean pero no se ven en detalle
- [ ] Reminders se crean pero no se listan ni completan
- [ ] No hay boton reasignar lead
- [ ] No muestra badge duplicado ni link al original
- [ ] Falta PATCH /leads/:id (editar lead) en backend y frontend

### PRODUCTOS (Backend OK)
- [ ] Pagina usa mock, hook conectado pero no la pagina
- [ ] Crear/editar/desactivar no llaman API

### DOSSIERS (Backend OK)
- [ ] Upload no conectado (falta config R2)
- [ ] Boton ver PDF no funciona
- [ ] Historial versiones no se muestra

### SIN BACKEND AUN
- [ ] Conversiones: registrar, abonos, cron vencidos (CRM-74 a CRM-76)
- [ ] Dashboard: ingresos por mes, tasa conversion, leads temporal (CRM-80, CRM-81)
- [ ] CRUD proyectos en Settings
- [ ] Panel webhooks en Settings
