import { describe, it, expect } from 'vitest';
import { llamar, cuentaDelCampus, MoodleError } from '../src/shared/services/moodle.client.js';

/*
  Revisión de la #689: cuando el plugin rechaza un envío o una nota, el motivo tiene que
  llegar al CRM (y quedar guardado en el mensaje que no salió) aunque el campus tenga la
  depuración apagada, como en producción.

    · El plugin 1.10.2 pone el motivo en `message`: se guarda tal cual.
    · Con uno anterior, `message` es el genérico de Moodle («Invalid parameter value
      detected») y el motivo, si viene, está en `debuginfo`: se usa ese.

  Sin red: un Moodle de mentira que contesta lo que se le pide.
*/

const conexion = { url: 'https://campus.prueba.local', token: 't' };
const contesta = (datos) => ({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => datos }) });
const fallo = async (datos) => {
  try {
    await llamar(conexion, 'local_crm_enviar_mensaje', {}, contesta(datos));
  } catch (err) {
    return err;
  }
  throw new Error('No ha fallado');
};

describe('#689 · el motivo del rechazo del campus no se pierde', () => {
  it('un error con un mensaje útil se guarda tal cual', async () => {
    const err = await fallo({ exception: 'moodle_exception', errorcode: 'enviarcomoadmin', message: 'No se puede enviar como el administrador del sitio.' });
    expect(err).toBeInstanceOf(MoodleError);
    expect(err.codigo).toBe('MOODLE');
    expect(err.message).toBe('El campus ha dicho: No se puede enviar como el administrador del sitio.');
  });

  it('con el mensaje genérico y `debuginfo`, se usa `debuginfo`', async () => {
    const err = await fallo({
      exception: 'invalid_parameter_exception', errorcode: 'invalidparameter',
      message: 'Invalid parameter value detected', debuginfo: 'Solo se puede enviar como personal del campus.',
    });
    expect(err.message).toBe('El campus ha dicho: Solo se puede enviar como personal del campus.');
  });

  it('con el mensaje genérico y sin `debuginfo` (depuración apagada, plugin anterior), queda el genérico', async () => {
    const err = await fallo({ exception: 'invalid_parameter_exception', errorcode: 'invalidparameter', message: 'Invalid parameter value detected' });
    expect(err.message).toBe('El campus ha dicho: Invalid parameter value detected.');
  });

  it('un mensaje útil no se cambia por `debuginfo` aunque venga', async () => {
    const err = await fallo({ exception: 'moodle_exception', errorcode: 'calificarsinpermiso', message: 'Esa persona no puede calificar esta tarea.', debuginfo: 'detalle interno' });
    expect(err.message).toBe('El campus ha dicho: Esa persona no puede calificar esta tarea.');
  });
});

describe('#689 · local_crm_cuenta: si una cuenta es el administrador del sitio', () => {
  it('con el plugin 1.10.2, lo que dice el campus', async () => {
    const r = await cuentaDelCampus(conexion, 2, contesta({ existe: true, siteadmin: true }));
    expect(r).toEqual({ existe: true, esAdministrador: true });
  });

  it('con un plugin anterior (la función no está o no está en el servicio): null, sin error', async () => {
    // Lo que contesta Moodle 5.0 a una función que no tiene (probado el 11/11).
    const sinFuncion = { exception: 'dml_missing_record_exception', errorcode: 'invalidrecordunknown', message: 'Can\'t find data record in database.' };
    expect(await cuentaDelCampus(conexion, 2, contesta(sinFuncion))).toBeNull();
    const fueraDelServicio = { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' };
    expect(await cuentaDelCampus(conexion, 2, contesta(fueraDelServicio))).toBeNull();
  });

  it('cualquier otro fallo sube como siempre', async () => {
    await expect(cuentaDelCampus(conexion, 2, contesta({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' })))
      .rejects.toMatchObject({ codigo: 'TOKEN' });
  });
});
