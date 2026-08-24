# Auditoria de rutas: que TODO lo que el frontal pide exista en el servidor.
#
# Es el fallo que ya nos ha mordido dos veces hoy —reportes servido en
# /api/reports mientras el frontal pedia /api/informes, y las cinco llamadas de
# WhatsApp sin usuarioId—, asi que se comprueba entero en vez de a mano.
#
# Se hace LEYENDO EL CODIGO, no llamando al servidor: una llamada devuelve 401 o
# 400 por mil razones y no distingue «no existe» de «te falta un parametro».
import io, os, re, sys, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf8", errors="replace")
RAIZ = "c:/Users/Diego/Desktop/Proyectos-Carlos"


def prefijos_del_backend(repo):
    """Los prefijos que registra cada modulo: /api/leads, /api/informes..."""
    fuera = {}
    for f in glob.glob("%s/%s/backend/src/modules/*/index.js" % (RAIZ, repo)):
        s = open(f, encoding="utf8", errors="replace").read()
        for m in re.finditer(r"(?:prefix|alias)\s*:\s*'([^']+)'", s):
            fuera[m.group(1)] = os.path.basename(os.path.dirname(f))
    return fuera


def rutas_del_backend(repo):
    """Cada ruta concreta: ('/api/leads', 'GET', '/:id') -> /api/leads/:id"""
    rutas = set()
    pref = prefijos_del_backend(repo)
    for carpeta, modulo in [(os.path.dirname(f), os.path.basename(os.path.dirname(f)))
                            for f in glob.glob("%s/%s/backend/src/modules/*/index.js" % (RAIZ, repo))]:
        mis = [p for p, m in pref.items() if m == modulo]
        for f in glob.glob(carpeta + "/*.routes.js") + glob.glob(carpeta + "/index.js"):
            s = open(f, encoding="utf8", errors="replace").read()
            for m in re.finditer(r"router\.(get|post|patch|put|delete)\(\s*'([^']*)'", s):
                for p in mis:
                    rutas.add((m.group(1).upper(), (p + m.group(2)).replace("//", "/").rstrip("/") or p))
    return rutas


def llamadas_del_frontal(repo):
    """Lo que el frontal pide, con el fichero y la linea donde lo pide."""
    fuera = []
    for f in glob.glob("%s/%s/frontend/src/**/*.*" % (RAIZ, repo), recursive=True):
        if not f.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        try:
            lineas = open(f, encoding="utf8", errors="replace").read().split("\n")
        except Exception:
            continue
        for n, l in enumerate(lineas, 1):
            for m in re.finditer(r"client\.(get|post|patch|put|delete)\(\s*[`'\"]([^`'\"$?]+)", l):
                camino = m.group(2).split("?")[0].rstrip("/")
                if not camino.startswith("/"):
                    continue
                fuera.append((m.group(1).upper(), "/api" + camino,
                              f.replace(RAIZ + "/" + repo + "/frontend/src/", ""), n))
    return fuera


def encaja(pedido, rutas):
    """¿Existe esa ruta?

    Lo que se busca no es el camino exacto: el patron corta en `${id}`, asi que
    `/leads/${id}` llega aqui como `/api/leads`. Lo que importa de verdad es si
    el servidor tiene ALGO colgando de ahi. Si no tiene nada, el prefijo esta mal
    —que es el fallo de reportes: el frontal pedia /api/informes y el servidor
    servia /api/reports— y eso si es un agujero.
    """
    metodo, camino = pedido
    tp = [x for x in camino.split("/") if x]
    for m2, r in rutas:
        tr = [x for x in r.split("/") if x]
        # ¿Coincide tramo a tramo hasta donde llega lo pedido?
        n = min(len(tp), len(tr))
        if n < 2:
            continue
        if all(tr[i].startswith(":") or tr[i] == tp[i] for i in range(n)):
            return True
    return False


for repo, nombre in [("CRM ISEIH", "MultiCRM"), ("CRM ISEIE", "ISEIE")]:
    print("######## " + nombre)
    rutas = rutas_del_backend(repo)
    llamadas = llamadas_del_frontal(repo)
    print("  el servidor expone %d rutas · el frontal hace %d llamadas distintas"
          % (len(rutas), len(set((m, c) for m, c, _, _ in llamadas))))

    huerfanas = {}
    for metodo, camino, fichero, linea in llamadas:
        if not encaja((metodo, camino), rutas):
            huerfanas.setdefault((metodo, camino), []).append("%s:%d" % (fichero, linea))

    if not huerfanas:
        print("  TODAS las llamadas del frontal tienen su ruta en el servidor")
    else:
        print("  llamadas SIN ruta en el servidor: %d" % len(huerfanas))
        for (metodo, camino), donde in sorted(huerfanas.items()):
            print("     %-6s %-42s %s" % (metodo, camino, donde[0] + ("  (+%d)" % (len(donde) - 1) if len(donde) > 1 else "")))
    print()
print("LISTO")
