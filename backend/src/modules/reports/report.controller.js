import * as model from './report.model.js';

export async function overview(req, res, next) {
  try {
    const { projectId, from, to } = req.query;
    const data = await model.overview({
      projectId: projectId ? Number(projectId) : null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
