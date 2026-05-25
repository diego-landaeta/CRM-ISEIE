# 03 — API endpoints (auto-generado)

> Generado por `scripts/gen-api-docs.mjs` desde el código de `backend/src/modules`.
> Última generación: 2026-05-25.

Convención: todos los endpoints (excepto los marcados "público") requieren `Authorization: Bearer <accessToken>` en el header.

Total: **29** módulos · **249** endpoints.

## Índice

- [`/api/accounting`](#accounting) — 6 endpoints
- [`/api/accounts-payable`](#accounts-payable) — 7 endpoints
- [`/api/auth`](#auth) — 7 endpoints
- [`/api/commissions`](#commissions) — 10 endpoints
- [`/api/connectors`](#connectors) — 7 endpoints
- [`/api/conversions`](#conversions) — 18 endpoints
- [`/api/credentials`](#credentials) — 4 endpoints
- [`/api/documents`](#documents) — 10 endpoints
- [`/api/dossiers`](#dossiers) — 3 endpoints
- [`/api/email-sequences`](#email-sequences) — 8 endpoints
- [`/api/email-templates`](#email-templates) — 7 endpoints
- [`/api/expenses`](#expenses) — 5 endpoints
- [`/api/field-definitions`](#field-definitions) — 5 endpoints
- [`/api/forms`](#forms) — 13 endpoints
- [`/api/installation`](#installation) — 2 endpoints
- [`/api/leads`](#leads) — 27 endpoints
- [`/api/make-webhooks`](#make) — 8 endpoints
- [`/api/matriculas`](#matriculas) — 8 endpoints
- [`/api/payroll`](#payroll) — 13 endpoints
- [`/api/permissions`](#permissions) — 10 endpoints
- [`/api/product-categories`](#product-categories) — 6 endpoints
- [`/api/products`](#products) — 10 endpoints
- [`/api/project-channels`](#project-channels) — 4 endpoints
- [`/api/projects`](#projects) — 7 endpoints
- [`/api/reports`](#reports) — 1 endpoints
- [`/api/status`](#status) — 6 endpoints
- [`/api/users`](#users) — 17 endpoints
- [`/api/webhook-tokens`](#webhook-tokens) — 8 endpoints
- [`/api/woocommerce`](#woocommerce) — 12 endpoints

---

## accounting

Prefix: `/api/accounting`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/accounting/dashboard` | _público_ |
| GET | `/api/accounting/expenses` | _público_ |
| GET | `/api/accounting/expenses/:id` | _público_ |
| POST | `/api/accounting/expenses` | _público_ |
| PATCH | `/api/accounting/expenses/:id` | _público_ |
| DELETE | `/api/accounting/expenses/:id` | _público_ |

## accounts-payable

Prefix: `/api/accounts-payable`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/accounts-payable/` | _público_ |
| GET | `/api/accounts-payable/stats` | _público_ |
| GET | `/api/accounts-payable/:id` | _público_ |
| POST | `/api/accounts-payable/` | _público_ |
| PATCH | `/api/accounts-payable/:id` | _público_ |
| DELETE | `/api/accounts-payable/:id` | _público_ |
| POST | `/api/accounts-payable/:id/payments` | _público_ |

## auth

Prefix: `/api/auth`

| Método | Path | Roles |
|---|---|---|
| POST | `/api/auth/login` | _público_ |
| POST | `/api/auth/refresh` | _público_ |
| POST | `/api/auth/logout` | autenticado |
| POST | `/api/auth/set-password` | _público_ |
| GET | `/api/auth/me` | autenticado |
| POST | `/api/auth/change-password` | autenticado |
| PATCH | `/api/auth/me` | autenticado |

## commissions

Prefix: `/api/commissions`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/commissions/rules` | _público_ |
| POST | `/api/commissions/rules` | _público_ |
| PATCH | `/api/commissions/rules/:id` | _público_ |
| DELETE | `/api/commissions/rules/:id` | _público_ |
| GET | `/api/commissions/me` | _público_ |
| GET | `/api/commissions/me/stats` | _público_ |
| GET | `/api/commissions/` | _público_ |
| GET | `/api/commissions/stats` | _público_ |
| PATCH | `/api/commissions/:id/pay` | _público_ |
| POST | `/api/commissions/recalculate/:conversionId` | _público_ |

## connectors

Prefix: `/api/connectors`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/connectors/` | _público_ |
| GET | `/api/connectors/:id` | _público_ |
| POST | `/api/connectors/` | _público_ |
| PATCH | `/api/connectors/:id` | _público_ |
| DELETE | `/api/connectors/:id` | _público_ |
| POST | `/api/connectors/:id/preview` | _público_ |
| POST | `/api/connectors/:id/import` | _público_ |

## conversions

Prefix: `/api/conversions`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/conversions/` | _público_ |
| GET | `/api/conversions/by-lead/:leadId` | _público_ |
| GET | `/api/conversions/:id` | _público_ |
| POST | `/api/conversions/` | _público_ |
| PATCH | `/api/conversions/:id` | _público_ |
| POST | `/api/conversions/:id/payments` | _público_ |
| DELETE | `/api/conversions/payments/:paymentId` | _público_ |
| GET | `/api/conversions/:id/installments` | _público_ |
| POST | `/api/conversions/:id/installments/generate` | _público_ |
| PATCH | `/api/conversions/installments/:instId` | _público_ |
| POST | `/api/conversions/installments/:instId/pay` | _público_ |
| PATCH | `/api/conversions/installments/:instId/paid` | _público_ |
| POST | `/api/conversions/installments/:instId/unpay` | _público_ |
| DELETE | `/api/conversions/installments/:instId` | _público_ |
| GET | `/api/conversions/:id/refunds` | _público_ |
| POST | `/api/conversions/:id/refunds` | _público_ |
| DELETE | `/api/conversions/refunds/:refundId` | _público_ |
| DELETE | `/api/conversions/:id` | _público_ |

## credentials

Prefix: `/api/credentials`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/credentials/` | _público_ |
| POST | `/api/credentials/` | _público_ |
| POST | `/api/credentials/:id/test` | _público_ |
| DELETE | `/api/credentials/:id` | _público_ |

## documents

Prefix: `/api/documents`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/documents/` | _público_ |
| GET | `/api/documents/:id/download` | _público_ |
| GET | `/api/documents/:id/audit` | _público_ |
| GET | `/api/documents/next-number` | _público_ |
| POST | `/api/documents/set-number` | _público_ |
| POST | `/api/documents/preview` | _público_ |
| POST | `/api/documents/generate` | _público_ |
| POST | `/api/documents/:id/regenerate` | _público_ |
| POST | `/api/documents/:id/resend-email` | _público_ |
| DELETE | `/api/documents/:id` | _público_ |

## dossiers

Prefix: `/api/dossiers`

| Método | Path | Roles |
|---|---|---|
| POST | `/api/dossiers/upload` | _público_ |
| GET | `/api/dossiers/:id/url` | _público_ |
| GET | `/api/dossiers/product/:productId/history` | _público_ |

## email-sequences

Prefix: `/api/email-sequences`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/email-sequences/` | _público_ |
| GET | `/api/email-sequences/runs` | _público_ |
| GET | `/api/email-sequences/:id` | _público_ |
| POST | `/api/email-sequences/` | _público_ |
| PATCH | `/api/email-sequences/:id` | _público_ |
| DELETE | `/api/email-sequences/:id` | _público_ |
| POST | `/api/email-sequences/runs/start` | _público_ |
| POST | `/api/email-sequences/runs/:runId/stop` | _público_ |

## email-templates

Prefix: `/api/email-templates`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/email-templates/variables` | _público_ |
| GET | `/api/email-templates/` | _público_ |
| GET | `/api/email-templates/:id` | _público_ |
| POST | `/api/email-templates/:id/render` | _público_ |
| POST | `/api/email-templates/` | _público_ |
| PATCH | `/api/email-templates/:id` | _público_ |
| DELETE | `/api/email-templates/:id` | _público_ |

## expenses

Prefix: `/api/expenses`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/expenses/` | _público_ |
| GET | `/api/expenses/:id` | _público_ |
| POST | `/api/expenses/` | _público_ |
| PATCH | `/api/expenses/:id` | _público_ |
| DELETE | `/api/expenses/:id` | _público_ |

## field-definitions

Prefix: `/api/field-definitions`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/field-definitions/project/:projectId` | _público_ |
| POST | `/api/field-definitions/` | _público_ |
| PATCH | `/api/field-definitions/:id` | _público_ |
| DELETE | `/api/field-definitions/:id` | _público_ |
| POST | `/api/field-definitions/reorder` | _público_ |

## forms

Prefix: `/api/forms`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/forms/public/:embedId` | _público_ |
| POST | `/api/forms/public/:embedId/submit` | _público_ |
| POST | `/api/forms/webhook/:embedId` | _público_ |
| POST | `/api/forms/mailhook/:embedId` | _público_ |
| GET | `/api/forms/` | _público_ |
| GET | `/api/forms/:id` | _público_ |
| GET | `/api/forms/:id/status` | _público_ |
| GET | `/api/forms/:id/events` | _público_ |
| POST | `/api/forms/` | _público_ |
| PATCH | `/api/forms/:id` | _público_ |
| DELETE | `/api/forms/:id` | _público_ |
| POST | `/api/forms/:id/listen` | _público_ |
| POST | `/api/forms/:id/listen/stop` | _público_ |

## installation

Prefix: `/api/installation`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/installation/` | _público_ |
| PATCH | `/api/installation/` | _público_ |

## leads

Prefix: `/api/leads`

| Método | Path | Roles |
|---|---|---|
| POST | `/api/leads/webhooks/:slug` | _público_ |
| GET | `/api/leads/` | _público_ |
| GET | `/api/leads/stats` | _público_ |
| GET | `/api/leads/today` | _público_ |
| GET | `/api/leads/dashboard-summary` | _público_ |
| GET | `/api/leads/lookup-by-email` | _público_ |
| GET | `/api/leads/spam-reports` | _público_ |
| GET | `/api/leads/spam-reports/count` | _público_ |
| PATCH | `/api/leads/spam-reports/:reportId` | _público_ |
| GET | `/api/leads/:id` | _público_ |
| POST | `/api/leads/:id/merge` | _público_ |
| POST | `/api/leads/` | _público_ |
| POST | `/api/leads/bulk` | _público_ |
| PATCH | `/api/leads/:id` | _público_ |
| PATCH | `/api/leads/:id/status` | _público_ |
| POST | `/api/leads/:id/interactions` | _público_ |
| POST | `/api/leads/:id/reminders` | _público_ |
| PATCH | `/api/leads/reminders/:reminderId/complete` | _público_ |
| GET | `/api/leads/:id/sequences` | _público_ |
| GET | `/api/leads/:id/purchase-history` | _público_ |
| POST | `/api/leads/:id/send-email` | _público_ |
| GET | `/api/leads/:id/emails` | _público_ |
| POST | `/api/leads/:id/report-spam` | _público_ |
| PATCH | `/api/leads/:id/reassign` | _público_ |
| DELETE | `/api/leads/:id` | _público_ |
| PATCH | `/api/leads/:id/restore` | _público_ |
| POST | `/api/leads/reassign-pending` | _público_ |

## make

Prefix: `/api/make-webhooks`

| Método | Path | Roles |
|---|---|---|
| POST | `/api/make-webhooks/make/:slug` | _público_ |
| GET | `/api/make-webhooks/` | _público_ |
| GET | `/api/make-webhooks/:id` | _público_ |
| POST | `/api/make-webhooks/` | _público_ |
| PATCH | `/api/make-webhooks/:id` | _público_ |
| DELETE | `/api/make-webhooks/:id` | _público_ |
| POST | `/api/make-webhooks/:id/rotate-secret` | _público_ |
| GET | `/api/make-webhooks/:id/deliveries` | _público_ |

## matriculas

Prefix: `/api/matriculas`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/matriculas/:id/doc/:tipo` | _público_ |
| GET | `/api/matriculas/` | _público_ |
| GET | `/api/matriculas/:id` | _público_ |
| POST | `/api/matriculas/` | _público_ |
| PATCH | `/api/matriculas/:id` | _público_ |
| DELETE | `/api/matriculas/:id` | _público_ |
| POST | `/api/matriculas/:id/estado` | _público_ |
| POST | `/api/matriculas/:id/doc/:tipo` | _público_ |

## payroll

Prefix: `/api/payroll`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/payroll/plans` | _público_ |
| PUT | `/api/payroll/plans` | _público_ |
| DELETE | `/api/payroll/plans/:id` | _público_ |
| GET | `/api/payroll/hours` | _público_ |
| POST | `/api/payroll/hours` | _público_ |
| DELETE | `/api/payroll/hours/:id` | _público_ |
| GET | `/api/payroll/periods` | _público_ |
| GET | `/api/payroll/periods/:id` | _público_ |
| POST | `/api/payroll/periods/generate` | _público_ |
| POST | `/api/payroll/periods/:id/close` | _público_ |
| POST | `/api/payroll/periods/:id/pay` | _público_ |
| POST | `/api/payroll/adjustments` | _público_ |
| DELETE | `/api/payroll/adjustments/:id` | _público_ |

## permissions

Prefix: `/api/permissions`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/permissions/system-defaults` | _público_ |
| GET | `/api/permissions/custom-roles` | _público_ |
| GET | `/api/permissions/custom-roles/:id` | _público_ |
| POST | `/api/permissions/custom-roles` | _público_ |
| PUT | `/api/permissions/custom-roles/:id` | _público_ |
| DELETE | `/api/permissions/custom-roles/:id` | _público_ |
| GET | `/api/permissions/users/:userId/permissions` | _público_ |
| PUT | `/api/permissions/users/:userId/permissions` | _público_ |
| GET | `/api/permissions/role-views/:roleKey` | _público_ |
| PUT | `/api/permissions/role-views/:roleKey` | _público_ |

## product-categories

Prefix: `/api/product-categories`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/product-categories/tree` | _público_ |
| GET | `/api/product-categories/project/:projectId` | _público_ |
| GET | `/api/product-categories/:id/ancestors` | _público_ |
| POST | `/api/product-categories/` | _público_ |
| PATCH | `/api/product-categories/:id` | _público_ |
| DELETE | `/api/product-categories/:id` | _público_ |

## products

Prefix: `/api/products`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/products/` | _público_ |
| GET | `/api/products/export` | _público_ |
| GET | `/api/products/leads-stats` | _público_ |
| GET | `/api/products/:id` | _público_ |
| GET | `/api/products/:id/image-url` | _público_ |
| POST | `/api/products/` | _público_ |
| PATCH | `/api/products/:id` | _público_ |
| DELETE | `/api/products/:id` | _público_ |
| POST | `/api/products/:id/image` | _público_ |
| DELETE | `/api/products/:id/image` | _público_ |

## project-channels

Prefix: `/api/project-channels`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/project-channels/` | _público_ |
| POST | `/api/project-channels/` | _público_ |
| PATCH | `/api/project-channels/:id` | _público_ |
| DELETE | `/api/project-channels/:id` | _público_ |

## projects

Prefix: `/api/projects`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/projects/shortcuts/catalog` | _público_ |
| GET | `/api/projects/` | _público_ |
| GET | `/api/projects/:id` | _público_ |
| POST | `/api/projects/` | _público_ |
| PATCH | `/api/projects/:id` | _público_ |
| POST | `/api/projects/:id/regenerate-webhook-key` | _público_ |
| GET | `/api/projects/:id/queue-state` | _público_ |

## reports

Prefix: `/api/reports`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/reports/overview` | _público_ |

## status

Prefix: `/api/status`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/status/` | _público_ |
| GET | `/api/status/incidents` | _público_ |
| POST | `/api/status/incidents` | _público_ |
| PUT | `/api/status/incidents/:id` | _público_ |
| PUT | `/api/status/components/:slug` | _público_ |
| GET | `/api/status/errors` | _público_ |

## users

Prefix: `/api/users`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/users/:id/avatar` | _público_ |
| POST | `/api/users/:id/avatar` | _público_ |
| DELETE | `/api/users/:id/avatar` | _público_ |
| GET | `/api/users/:id/views` | _público_ |
| PATCH | `/api/users/:id/views` | _público_ |
| GET | `/api/users/` | _público_ |
| GET | `/api/users/activity-log` | _público_ |
| GET | `/api/users/availability` | _público_ |
| DELETE | `/api/users/availability-blocks/:blockId` | _público_ |
| GET | `/api/users/:id` | _público_ |
| POST | `/api/users/` | _público_ |
| PATCH | `/api/users/:id` | _público_ |
| DELETE | `/api/users/:id` | _público_ |
| PATCH | `/api/users/:id/reactivate` | _público_ |
| PATCH | `/api/users/:id/availability` | _público_ |
| GET | `/api/users/:id/availability-blocks` | _público_ |
| POST | `/api/users/:id/availability-blocks` | _público_ |

## webhook-tokens

Prefix: `/api/webhook-tokens`

| Método | Path | Roles |
|---|---|---|
| POST | `/api/webhook-tokens/receive/:token` | _público_ |
| GET | `/api/webhook-tokens/` | _público_ |
| GET | `/api/webhook-tokens/:id/status` | _público_ |
| POST | `/api/webhook-tokens/` | _público_ |
| PATCH | `/api/webhook-tokens/:id` | _público_ |
| DELETE | `/api/webhook-tokens/:id` | _público_ |
| POST | `/api/webhook-tokens/:id/listen` | _público_ |
| POST | `/api/webhook-tokens/:id/listen/stop` | _público_ |

## woocommerce

Prefix: `/api/woocommerce`

| Método | Path | Roles |
|---|---|---|
| GET | `/api/woocommerce/credentials` | _público_ |
| PUT | `/api/woocommerce/credentials` | _público_ |
| DELETE | `/api/woocommerce/credentials` | _público_ |
| GET | `/api/woocommerce/mappings` | _público_ |
| PUT | `/api/woocommerce/mappings` | _público_ |
| GET | `/api/woocommerce/runs` | _público_ |
| GET | `/api/woocommerce/runs/current` | _público_ |
| POST | `/api/woocommerce/runs/start` | _público_ |
| POST | `/api/woocommerce/auto-discover-cpts` | _público_ |
| GET | `/api/woocommerce/preview` | _público_ |
| PUT | `/api/woocommerce/mapping` | _público_ |
| POST | `/api/woocommerce/scrape-preview` | _público_ |
