---
title: Cómo elegir una aplicación de finanzas personales que respete su privacidad
description: Ocho preguntas que hacer a cualquier aplicación de finanzas sobre sus datos, con las respuestas de MoneyMatter, incluidas aquellas en las que se queda corta.
published: 2026-11-25
related:
  - /features/security-and-privacy
  - /features/export-and-backup
  - /features/ai-categorization
docs:
  - label: Seguridad y cuenta
    href: https://docs.moneymatter.app/settings/security-and-account/
  - label: Funciones de IA
    href: https://docs.moneymatter.app/ai/ai-features/
  - label: Conexiones bancarias
    href: https://docs.moneymatter.app/import/bank-connections/
---

Una aplicación de finanzas sabe más de usted que la mayoría de las aplicaciones: dónde compra, cuánto gana, a quién le paga el alquiler. Un «Nos tomamos su privacidad en serio» en una página de inicio no le dice nada. Las preguntas de abajo sí.

Cada una viene con la respuesta de MoneyMatter, incluidas aquellas en las que se queda corta, para que pueda compararla de forma justa con cualquier otra aplicación.

## 1. ¿Cómo gana dinero la aplicación?

Los servidores cuestan dinero, y la factura se paga de alguna forma. Si una aplicación es gratuita y muestra anuncios, o cobra una comisión cuando usted abre la tarjeta o el préstamo que le recomienda, sus datos de gasto forman parte de cómo se le paga.

MoneyMatter se paga con suscripciones. No muestra anuncios ni usa rastreadores de Google o Facebook.

## 2. ¿Cómo se conecta a su banco?

Busque una conexión de solo lectura en la que inicie sesión en la web o la aplicación de su propio banco. Desconfíe de cualquier aplicación que le pida la contraseña de su banco.

Las conexiones bancarias de MoneyMatter son de solo lectura: pueden ver cuentas, saldos y transacciones, y no pueden mover dinero. La contraseña de su banco nunca se guarda. Las claves y los tokens de sus conexiones se cifran con AES-256-GCM, así que una copia de la base de datos por sí sola no los revela. También puede prescindir por completo de la sincronización bancaria y añadir transacciones a mano o desde archivos.

## 3. ¿Quién puede leer sus transacciones?

Pregunte si la aplicación tiene cifrado de extremo a extremo. Si lo tiene, la empresa no puede leer sus datos, y sus servidores tampoco pueden crear informes ni usar IA con ellos.

MoneyMatter no tiene cifrado de extremo a extremo. Todo el tráfico usa HTTPS, pero las transacciones y los saldos se guardan de forma que el servidor pueda leerlos y crear sus informes. Eso significa que quien gestione el servidor puede acceder a ellos, y en MoneyMatter Cloud, ese es MoneyMatter.

## 4. ¿Qué otras empresas ven sus datos?

Toda aplicación depende de algunos servicios externos. Una aplicación de confianza los nombra y dice qué recibe cada uno. Los principales de MoneyMatter:

- **Stripe** gestiona los pagos. Recibe los datos de su tarjeta, y MoneyMatter nunca recibe el número de la tarjeta.
- **Resend** envía los correos de inicio de sesión y de la cuenta.
- **Sentry** recibe los informes de errores, que incluyen su correo. Una sesión con un error puede incluir una grabación, con todo el texto oculto y los archivos multimedia bloqueados.
- **PostHog** recibe analítica de producto vinculada a su cuenta y su correo. Las cuentas reales no tienen grabación de sesiones. Active Do Not Track en su navegador para detener la analítica que envía su navegador. El servidor sigue registrando eventos como los inicios de sesión.
- **Su proveedor de datos bancarios y su proveedor de IA**, si usa la sincronización bancaria o la IA.

La [política de privacidad](/privacy-policy) enumera también los más pequeños, como logo.dev para los logotipos de los beneficiarios, con lo que recibe cada uno.

## 5. ¿Qué envía a la IA?

La categorización con IA ahorra mucho tecleo, pero significa que los detalles de las transacciones salen de la aplicación. Pregunte qué se envía, a quién y si puede usar su propio proveedor.

En Plus y durante la prueba, MoneyMatter envía cada transacción bancaria nueva a la IA con su importe, moneda, fecha, nombre de la cuenta, nota y beneficiario, además de los nombres de sus categorías. No se envían sus saldos. Las transacciones que añade a mano no se envían a categorizar automáticamente. En Plus, ningún interruptor único desactiva la categorización automática.

Añada su propia clave de OpenAI, Anthropic o Gemini en los ajustes de IA, y las funciones de IA la usarán en su lugar. Las sugerencias de presupuesto siempre usan la IA de MoneyMatter.

Si conecta Claude, ChatGPT u otro asistente a sus datos, antes de aprobarlo elige si solo puede leer o si también puede crear, editar o eliminar registros. Puede revocarlo en los ajustes en cualquier momento.

## 6. ¿Puede comprobar lo que hace?

Una aplicación cerrada le pide que confíe en su política de privacidad. Con una aplicación de código abierto, cualquiera puede leer el código y ver cómo se tratan sus datos.

MoneyMatter es de código abierto bajo la licencia AGPL-3.0, y su código es público en GitHub. No tiene ninguna auditoría de seguridad ni certificación de terceros publicada.

## 7. ¿Cómo inicia sesión, y puede ver quién tiene la sesión iniciada?

Un inicio de sesión sólido importa más que las promesas de cifrado, porque la mayoría de los robos de cuentas empiezan con una contraseña robada.

MoneyMatter le permite iniciar sesión con una clave de acceso, Google, GitHub, Apple o una contraseña, y mantener varios métodos a la vez como respaldo. No tiene autenticación en dos pasos. Para proteger su cuenta sin ella, inicie sesión con una clave de acceso, o con Google o GitHub, donde se aplica su propia configuración de verificación en dos pasos. Si su cuenta también tiene contraseña, esa contraseña sigue funcionando.

La pestaña **Sesiones activas** muestra cada navegador y dispositivo con la sesión iniciada, con su dirección IP y cuándo estuvo activo por última vez. Cierre la sesión de uno que le parezca sospechoso, o de todas las demás sesiones a la vez. Restablecer la contraseña cierra su sesión en todas partes y desconecta las aplicaciones conectadas, incluidos los asistentes de IA.

![La pestaña «Active Sessions» con la sesión actual marcada como «Current», otros dispositivos debajo y el botón «Sign out of all other sessions»](/img/landing/screenshots/features/settings/active-sessions@2x.webp)

## 8. ¿Puede llevarse sus datos e irse?

Una aplicación que pone difícil irse tiene menos motivos para tratar bien sus datos. Compruebe que puede exportarlo todo y eliminar su cuenta sin escribir a nadie.

En MoneyMatter, desde **Ajustes** puede:

- **Exportar** transacciones, presupuestos, suscripciones e inversiones como CSV, Excel o JSON.
- **Descargar copia de seguridad**: un único zip con una copia completa de sus datos.
- **Borrar todos los datos** y empezar de nuevo con el mismo inicio de sesión, o **Eliminar su cuenta** y todos sus datos, desde la pestaña **Zona de peligro**. Las dos acciones son permanentes.

Tras eliminar su cuenta, MoneyMatter guarda un hash unidireccional de su correo para que una cuenta nueva no pueda volver a empezar la prueba gratuita. Los registros ya enviados a Sentry y PostHog no se eliminan automáticamente, y puede pedir por correo que se eliminen.

No se elimina nada cuando termina una prueba o una suscripción. Su cuenta pasa a ser de solo lectura, y aún puede iniciar sesión y descargar una exportación.

![La pestaña «Danger Zone» con la sección «Wipe all data» y la sección «Delete your account»](/img/landing/screenshots/features/settings/danger-zone@2x.webp)

## La lista de comprobación

| Pregunta                             | Qué buscar                                          | MoneyMatter                                                    |
| ------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------- |
| ¿Cómo gana dinero?                   | Paga usted, no los anunciantes                      | Suscripciones, sin anuncios                                    |
| ¿Cómo se conecta a su banco?         | Solo lectura, sin la contraseña del banco           | Solo lectura, credenciales cifradas                            |
| ¿Quién puede leer sus transacciones? | Una respuesta clara                                 | El servidor, sin cifrado de extremo a extremo                  |
| ¿Qué empresas ven sus datos?         | Una lista con nombres                               | Nombradas en la política de privacidad                         |
| ¿Qué se envía a la IA?               | Los campos, y la opción de usar su propio proveedor | Enumerados, admite clave propia                                |
| ¿Puede revisar el código?            | Código abierto                                      | AGPL-3.0, sin auditoría de terceros                            |
| ¿Cómo se inicia sesión?              | Claves de acceso o dos pasos                        | Claves de acceso, sin dos pasos                                |
| ¿Puede irse?                         | Exportación completa, eliminación sin ayuda         | Exportación, copia de seguridad, eliminación desde los ajustes |
