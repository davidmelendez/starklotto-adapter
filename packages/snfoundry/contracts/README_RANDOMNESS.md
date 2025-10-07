## Guía: Contrato de Aleatoriedad (VRF Cartridge) para StarkLotto

Esta guía explica cómo implementar desde cero el contrato `Randomness.cairo`, compilarlo y desplegarlo con Scaffold-Stark, y cómo probar la generación de números en Sepolia Testnet desde el `Debug` de la dApp.

### 1) Requisitos previos
- Node.js 18+
- Yarn
- Cairo/Scarb (instalación de Starknet Foundry)
- Wallet con fondos en la red que uses (devnet no requiere fondos)

### 2) Estructura del proyecto relevante
- Código Cairo: `packages/snfoundry/contracts/src`
- Contrato nuevo: `Randomness.cairo`
- Export en `src/lib.cairo`
- Scripts de deploy: `packages/snfoundry/scripts-ts`
- Generación de artefactos para front: `packages/nextjs/contracts/deployedContracts.ts`

### 3) Dependencias de VRF
En `packages/snfoundry/contracts/Scarb.toml` ya se declara la dependencia `cartridge_vrf`.

### 4) Contrato `Randomness.cairo`
El contrato implementa:
- Solicitud de aleatoriedad (producción) vía VRF (Cartridge).
- Generación local para devnet (`devnet_generate`).
- Almacenamiento transparente: ID incremental, estado, timestamps, números.
- Eventos: requested, completed, failed y test.
- Lecturas: `get_generation_numbers`, `get_generation_status`, `get_generation_timestamps`, `get_latest_id`.

Constructor:
```text
constructor(owner: ContractAddress, vrf_coordinator: ContractAddress, dev_mode: bool)
```

Entradas principales:
- `request_randomness_prod(seed, callback_fee_limit, publish_delay) -> id`
- `devnet_generate(seed) -> id`
- `receive_random_words(...)` (callback VRF, expuesto como `external`)

Notas importantes:
- El contrato valida rango 1..49 y unicidad en 5 números derivados.
- Para producción, debes pasar la dirección del coordinador VRF real al constructor o usar `set_vrf_coordinator`.

### 5) Compilar contratos
Desde la raíz del workspace del paquete `snfoundry`:
```bash
yarn workspace @ss-2/snfoundry compile
```

Si hay errores, verifica `Scarb.toml` y que `lib.cairo` exporte `pub mod Randomness;`.

### 6) Deploy con Scaffold-Stark
El script `packages/snfoundry/scripts-ts/deploy.ts` ya apunta a `Randomness` y utiliza constructor con:
- `owner = deployer.address`
- `vrf_coordinator = deployer.address` (placeholder en devnet)
- `dev_mode = true`

Para devnet:
```bash
yarn workspace @ss-2/snfoundry deploy --network devnet
```

Para Sepolia (testnet):
1. Configura variables en `packages/snfoundry/.env` (cuenta, provider RPC).
2. Ajusta el `vrf_coordinator` a la dirección del coordinador VRF de Cartridge en Sepolia.
3. Ejecuta:
```bash
yarn workspace @ss-2/snfoundry deploy --network sepolia
```

Al final, el script actualizará `packages/nextjs/contracts/deployedContracts.ts` con dirección y ABI.

### 7) Probar en Debug (Scaffold) – Devnet
1. Ejecuta la dApp:
```bash
yarn workspace @ss-2/nextjs dev
```
2. Abre `http://localhost:3000/debug` y localiza el contrato `Randomness` desplegado.
3. Prueba el flujo dev:
   - Llama `devnet_generate(seed: u64)` → retorna `id`.
   - Llama `get_generation_status(id)` → debe ser `2` (COMPLETED).
   - Llama `get_generation_numbers(id)` → devuelve `[n1..n5]`, únicos en 1..49.
   - Revisa eventos `TestGeneration` y timestamps con `get_generation_timestamps(id)`.

### 8) Probar en Debug – Testnet (Sepolia)
1. Asegúrate de haber desplegado con `dev_mode=false` si no necesitas pruebas locales.
2. Asegúrate de que `vrf_coordinator` apunte al coordinador VRF de Cartridge.
3. (Opcional) Financia el contrato si el oracle requiere fees para callback.
4. En `Debug` del front:
   - Llama `request_randomness_prod(seed, callback_fee_limit, publish_delay)` → retorna `id`.
   - Espera el fulfillment del VRF; luego `get_generation_status(id)` → `2`.
   - Llama `get_generation_numbers(id)`.
   - Revisa los eventos `GenerationRequested` y `GenerationCompleted`.

### 9) Consideraciones de producción
- Reemplaza el placeholder del import/comentario del dispatcher VRF por el real de `cartridge_vrf` y ajusta los nombres de interfaz si difieren.
- Asegura control de acceso si deseas que sólo el owner pueda solicitar aleatoriedad.
- Cubre el costo de callback si el oracle lo requiere (aprobar tokens/ETH según documentación del VRF).
- Implementa monitoreo de eventos y reintentos mediante `mark_generation_failed` si hay problemas.

### 10) Tests sugeridos (snforge)
- `devnet_generate` devuelve 5 valores únicos en 1..49.
- `get_generation_numbers` falla si el estado no es COMPLETED.
- Orden cronológico: `requested_at <= fulfilled_at`.
- Eventos emitidos correctamente.

### 11) Errores comunes
- Constructor con `vrf_coordinator` incorrecto en testnet.
- ABI/artefactos no presentes por no compilar antes de deploy.
- No ejecutar `executeDeployCalls()` dentro del flujo de deploy.

Con esto tendrás un flujo completo para generar números aleatorios trazables con un timeline transparente, tanto en devnet como en testnet con VRF de Cartridge.


