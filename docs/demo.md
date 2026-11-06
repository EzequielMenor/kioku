# Demo en el navegador

La demo es una simulación: el motor de `web/src/demo/` responde al contrato de `/api/*` en memoria y guarda los datos de ejemplo solo en el `localStorage` de tu navegador. No hay daemon, no se llama a ninguna red y no se copia nada de tu bóveda real.

## Cuándo arranca

| Situación | ¿Demo? |
|---|---|
| Alojamiento estático reconocido (`*.vercel.app`) | Sí, con la portada en `#/inicio` |
| Cualquier otro host (propio, privado, `*.ts.net`, `localhost`) | No: se usa el daemon y la sesión real |
| Host propio con `?demo=1` o `#/demo` | Sí, porque lo pides tú |
| El daemon responde 404 | No: no se activa la demo por un error |

La marca `kioku.demo.active` del `localStorage` recuerda una demo que activaste tú en ese navegador; bórrala para volver al espacio real.

## Qué no es

- **Kioku Cloud** está planificado: no hay servicio alojado, cuentas, planes ni cobros. La portada no recoge correos ni guarda ninguna solicitud.
- Editar las propiedades de una base no se simula; la demo lo rechaza con un aviso.

## Vista previa local

```sh
npm run preview:demo   # construye la interfaz y sirve dist/web en http://127.0.0.1:4173
```

El servidor solo escucha en `127.0.0.1`, responde 404 a `/api/*` y no sirve nada fuera de `dist/web`. Cambia el puerto con `PORT`.

El despliegue en Vercel usa `vercel.json` (`npm run build:web`, salida `dist/web`).
