---
title: Cómo usar open banking con una app de presupuestos en el Reino Unido y la UE
description: Conecte bancos del Reino Unido y de Europa a MoneyMatter con open banking, elija entre Lunch Flow y Enable Banking y mantenga la conexión activa.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/security-and-privacy
  - /features/multi-currency
docs:
  - label: Conexiones bancarias
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Ajustes generales
    href: https://docs.moneymatter.app/settings/general-settings/
  - label: Planes y facturación
    href: https://docs.moneymatter.app/settings/plans-and-billing/
---

En el Reino Unido y en la UE, los bancos tienen que permitirle compartir los datos de su cuenta con las aplicaciones que usted elija. Eso es open banking. Usted aprueba el acceso en la web o la aplicación de su propio banco, el acceso es de solo lectura y caduca pasado un tiempo si no lo renueva.

Para una aplicación de presupuestos, esto significa que sus transacciones llegan solas, sin exportar CSV ni teclear. Esta guía explica cómo configurarlo en MoneyMatter y qué esperar después.

## Qué da el open banking a una aplicación y qué no

- **Puede leer** sus cuentas, saldos y transacciones.
- **No puede mover dinero.** Las conexiones bancarias de MoneyMatter son de solo lectura.
- **Nunca ve la contraseña de su banco.** Usted inicia sesión en su banco, y MoneyMatter solo guarda los tokens de acceso y las claves, cifrados con AES-256-GCM.

## Dos formas de conectar desde el Reino Unido y la UE

La sincronización bancaria forma parte del plan Plus, y la prueba gratuita de 40 días la incluye, sin necesidad de tarjeta. En el Reino Unido y en la UE puede conectar a través de dos proveedores.

**Lunch Flow** es la vía fácil. Cubre más de 20.000 bancos del Reino Unido, la UE y otros países. Abre una cuenta en Lunch Flow, vincula allí sus bancos y pega su clave de API en MoneyMatter. Lunch Flow cobra por su propio servicio, aparte de su plan de MoneyMatter.

**Enable Banking** cubre más de 6.000 bancos de la UE y el Reino Unido y no cuesta nada extra. La pega es la configuración: usted registra su propia aplicación de desarrollador en Enable Banking y entrega a MoneyMatter su ID de aplicación y su clave privada. Está en beta y es adecuada para quien se maneje con configuraciones técnicas.

En Polonia, MoneyMatter también puede conectarse directamente a sus monederos de divisas de Walutomat, sin coste adicional.

![El diálogo «Add integration» con filtros por región y una lista de proveedores que incluye Lunch Flow, SimpleFIN, Akahu y Monobank, cada uno con su precio y su dificultad de configuración](/img/landing/screenshots/bank-providers@2x.webp)

## Conecte su banco

1. En la barra lateral, abra **Cuentas** → **Todas las cuentas**.
2. En la sección **Conexiones bancarias**, haga clic en **Conectar banco**.
3. Elija la región **UE y Reino Unido** y su proveedor.
4. Con Lunch Flow, pegue su clave de API y haga clic en **Conectar**. Con Enable Banking, introduzca su ID de aplicación y su clave privada, elija su país y su banco, y apruebe el acceso en su banco.
5. Elija las cuentas que quiera.

Con Enable Banking, termine en el mismo navegador en el que empezó, porque MoneyMatter recuerda ahí la conexión pendiente.

¿Ya controla una cuenta a mano? Conecte el banco sin esa cuenta, abra después la cuenta y vincúlela desde su pestaña **Conexión de datos**. Su historial se conserva y la sincronización continúa desde ahí.

## Cuánto historial obtiene

Con Enable Banking, la primera sincronización carga todo lo que permita su banco, desde 90 días hasta unos 3 años según el banco. Con Lunch Flow, obtiene lo que Lunch Flow tenga de la cuenta. Después, cada sincronización continúa desde su transacción más reciente.

## Pagos con tarjeta pendientes

Algunos bancos informan de un pago con tarjeta como pendiente antes de contabilizarlo. Con Enable Banking, MoneyMatter omite los pagos pendientes salvo que active **Importar transacciones bancarias pendientes** en **Ajustes** → **General**. Cuando el banco contabiliza un pago, la copia pendiente se fusiona con él, así que no aparece dos veces.

## Renueve el acceso antes de que caduque

El acceso de open banking dura un tiempo limitado. Con Enable Banking, MoneyMatter pide el periodo más largo que permita su banco, o 90 días si el banco no lo indica. La página de la conexión muestra cuántos días de consentimiento quedan.

Cuando quedan 7 días o menos, la conexión muestra **Próxima a caducar**. Cuando caduca, muestra **Caducada** y deja de sincronizar. Para renovarla, abra la página de la conexión, haga clic en **Reconectar ahora** y apruebe de nuevo el acceso en su banco. Sus cuentas siguen sincronizándose en las mismas cuentas de MoneyMatter, con su historial intacto.

## Cuentas en varias monedas

Mucha gente en Europa tiene cuentas en más de una moneda, como una cuenta corriente en euros y otra en libras o dólares. MoneyMatter mantiene cada cuenta en su propia moneda y muestra sus totales en su moneda base.

Cuando mueve dinero entre dos de sus cuentas conectadas en la misma moneda, ambas partes llegan desde sus bancos. MoneyMatter las vincula como una transferencia cuando encuentra exactamente una coincidencia con el mismo importe en sentido contrario dentro de 3 días, de modo que el movimiento no cuenta como gasto. Un cambio entre dos monedas suele necesitar su ayuda: abra la transacción, seleccione la pestaña **Transferencia** y vincule usted mismo la otra parte.
