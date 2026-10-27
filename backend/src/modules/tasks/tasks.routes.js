import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './tasks.controller.js';

const router = Router();

router.use(verifyToken);
// A la puerta del tablero basta con poder ver alguno (#423); cada acción mira
// su clave dentro del servicio (tasks.service.js · permisosDe).
router.use(puede('tasks.view_own', 'tasks.view_all'));

// Rutas fijas antes que /:id, para no chocar
router.get('/metrics', ctrl.teamMetrics);
router.get('/metrics/areas', ctrl.teamMetricsByArea);
router.get('/assignees', ctrl.assignees);
router.get('/tags', ctrl.tagNames);

// Vista por revisar
router.get('/review', ctrl.reviewTasks);
router.get('/review/count', ctrl.reviewCount);

// Equipos (26/10/2026): ver los suyos; gestionarlos, con «Gestionar equipos».
router.get('/teams', ctrl.listTeams);
router.get('/teams/mine', ctrl.myTeams);
router.get('/teams/empresas', ctrl.teamEmpresas);
router.post('/teams', ctrl.createTeam);
router.get('/teams/:teamId', ctrl.getTeam);
router.patch('/teams/:teamId', ctrl.updateTeam);
router.post('/teams/:teamId/roles', ctrl.createTeamRole);
router.patch('/teams/:teamId/roles/:roleId', ctrl.updateTeamRole);
router.get('/teams/:teamId/candidates', ctrl.teamCandidates);
router.put('/teams/:teamId/members/:userId', ctrl.setTeamMember);
router.delete('/teams/:teamId/members/:userId', ctrl.removeTeamMember);

// Configuración de columnas
router.get('/columns', ctrl.listColumns);
router.post('/columns', ctrl.createColumn);
router.patch('/columns/reorder', ctrl.reorderColumns);
router.patch('/columns/:id', ctrl.updateColumn);
router.delete('/columns/:id', ctrl.archiveColumn);

// Configuración de áreas
router.get('/areas', ctrl.listAreas);
router.post('/areas', ctrl.createArea);
router.get('/areas/assignments', ctrl.getUserAreaAssignments);
router.get('/areas/user/:userId', ctrl.getUserAreas);
router.put('/areas/user/:userId', ctrl.setUserAreas);
router.patch('/areas/:id', ctrl.updateArea);
router.put('/areas/:id/members', ctrl.setAreaMembers);

// Configuración de proyectos propios
router.get('/external-projects', ctrl.listExternalProjects);
router.post('/external-projects', ctrl.createExternalProject);
router.patch('/external-projects/:id', ctrl.updateExternalProject);

// Tareas
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id/move', ctrl.move);
router.patch('/:id/return', ctrl.returnTask);
router.patch('/:id/approve', ctrl.approve);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.archive);

// Elementos de la tarjeta
router.post('/:id/checklist', ctrl.addChecklistItem);
router.patch('/:id/checklist/:itemId', ctrl.updateChecklistItem);
router.delete('/:id/checklist/:itemId', ctrl.deleteChecklistItem);

router.post('/:id/comments', ctrl.addComment);
router.delete('/:id/comments/:commentId', ctrl.deleteComment);

router.post('/:id/tags', ctrl.addTag);
router.delete('/:id/tags/:tagId', ctrl.deleteTag);

router.post('/:id/links', ctrl.addLink);
router.delete('/:id/links/:linkId', ctrl.deleteLink);

export default router;
