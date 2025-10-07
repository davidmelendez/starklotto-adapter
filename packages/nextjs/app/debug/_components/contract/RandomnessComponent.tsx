"use client";

import { useState, useMemo } from "react";
import { useNetwork } from "@starknet-react/core";
import { useAccount } from "~~/hooks/useAccount";
import { useTransactor } from "~~/hooks/scaffold-stark/useTransactor";
import { useTargetNetwork } from "~~/hooks/scaffold-stark/useTargetNetwork";
import { notification } from "~~/utils/scaffold-stark";
import { ContractName } from "~~/utils/scaffold-stark/contract";
import { Address } from "~~/components/scaffold-stark";
import { Address as AddressType } from "@starknet-react/chains";
import { Call, CallData, num } from "starknet";

// Dirección del VRF provider de Cartridge en testnet
// Esta dirección debe ser actualizada con la dirección real proporcionada por Cartridge
const VRF_PROVIDER_ADDRESS =
  "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";

interface RandomnessComponentProps {
  contractName: ContractName;
  contractAddress: AddressType;
  onSuccess?: (txHash: string, generationId: string) => void;
}

interface VRFCoordinatorConfigProps {
  contractAddress: AddressType;
}

export const RandomnessComponent = ({
  contractName,
  contractAddress,
  onSuccess,
}: RandomnessComponentProps) => {
  const [seed, setSeed] = useState<string>("12345");
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");
  const [generationId, setGenerationId] = useState<string>("");
  const [useAlternativeMode, setUseAlternativeMode] = useState<boolean>(false);
  const [forceDevMode, setForceDevMode] = useState<boolean>(false);

  const { status: walletStatus, isConnected, account, chainId } = useAccount();
  const { chain } = useNetwork();
  const { targetNetwork } = useTargetNetwork();

  // Configuración de parámetros por defecto según requerimientos
  const callbackFeeLimit = "100000"; // 100000 wei como límite de callback
  const publishDelay = "0"; // Sin delay de publicación

  // Detectar si estamos en modo desarrollo o producción
  const isDevnet =
    chain?.network === "devnet" || targetNetwork.network === "devnet";

  // Crear instancia del contrato consumidor usando el contrato desplegado
  const { writeTransaction } = useTransactor();

  const writeDisabled = useMemo(
    () =>
      !chain ||
      chain?.network !== targetNetwork.network ||
      walletStatus === "disconnected",
    [chain, targetNetwork.network, walletStatus],
  );

  const handleRequestRandomness = async () => {
    if (!isConnected || writeDisabled) {
      notification.error(
        "Por favor conecta tu wallet y asegúrate de estar en la red correcta",
      );
      return;
    }

    // Verificación adicional de que la dirección es válida antes de proceder
    if (
      account?.address &&
      (!account.address.startsWith("0x") || account.address.length !== 66)
    ) {
      console.error(
        "❌ Dirección de cuenta con formato inválido:",
        account.address,
      );
      notification.error(
        "La dirección de la cuenta tiene un formato inválido. Intenta reconectar tu wallet.",
      );
      return;
    }

    if (!account?.address) {
      console.error("❌ No se pudo obtener la dirección de la cuenta:", {
        account,
        isConnected,
        walletStatus,
      });
      notification.error(
        "No se pudo obtener la dirección de la cuenta conectada. Intenta reconectar tu wallet.",
      );
      return;
    }

    // 🚨 VERIFICACIÓN ESPECÍFICA: Detectar cuenta problemática
    if (
      account?.address ===
      "0x0297fd6c19289a017d50b1b65a07ea4db27596a8fade85c6b9622a3f9a24d2a9"
    ) {
      console.warn("🚨 CUENTA PROBLEMÁTICA DETECTADA:", account.address);
      notification.error(
        "Se ha detectado una cuenta que puede causar problemas. Intenta reconectar tu wallet o usar una cuenta diferente.",
      );
      return;
    }

    if (!seed || isNaN(Number(seed))) {
      notification.error("Por favor ingresa un seed válido (número entero)");
      return;
    }

    // 🔍 DIAGNÓSTICO: Verificar información del contrato antes de proceder
    console.log("🔍 DIAGNÓSTICO - Información del contrato:", {
      contractName,
      contractAddress,
      expectedAddress:
        "0x31cdafdd0fc1a80d57f3290afff3ba0a62e9d2c628e35c81eb55e05879f0f4f",
      addressMatch:
        contractAddress ===
        "0x31cdafdd0fc1a80d57f3290afff3ba0a62e9d2c628e35c81eb55e05879f0f4f",
      chain: chain?.name,
      targetNetwork: targetNetwork.name,
      isDevnet:
        chain?.network === "devnet" || targetNetwork.network === "devnet",
    });

    // 🔍 DIAGNÓSTICO ADICIONAL: Verificar información de la cuenta y posibles problemas
    console.log("🔍 DIAGNÓSTICO - Información de la cuenta y transacción:", {
      accountAddress: account?.address,
      accountClass: account?.constructor?.name,
      accountProvider: account ? "AccountInterface" : "undefined",
      walletStatus,
      isConnected,
      chainId: chain?.id,
      targetNetworkId: targetNetwork.id,
      writeDisabledReason: writeDisabled
        ? "Wallet en red incorrecta o desconectada"
        : "Listo para transacción",
      contractAddress,
      functionToCall: isDevnet ? "devnet_generate" : "request_randomness_prod",
      calldataParams: isDevnet
        ? ["seed"]
        : ["seed", "callbackFeeLimit", "publishDelay"],
    });

    setIsLoading(true);
    setTxHash("");
    setGenerationId("");

    try {
      // Convertir seed a u64 (número entero sin signo de 64 bits)
      const seedValue = BigInt(seed);

      // Detectar si estamos en devnet o testnet/mainnet
      const isDevnet =
        forceDevMode ||
        chain?.network === "devnet" ||
        targetNetwork.network === "devnet";

      console.log(
        "🎯 Modo detectado:",
        isDevnet ? "DESARROLLO" : "PRODUCCIÓN",
        forceDevMode ? "(FORZADO)" : "",
      );

      if (isDevnet) {
        // Para desarrollo: usar devnet_generate directamente
        console.log("🔧 Ejecutando en modo DESARROLLO (devnet_generate)", {
          contractAddress,
          seed: seedValue.toString(),
          account: account?.address,
          function: "devnet_generate",
        });

        const seedHex = num.toHex(seedValue);

        const txHash = await writeTransaction([
          {
            contractAddress: contractAddress as string,
            entrypoint: "devnet_generate",
            calldata: [seedHex],
          },
        ]);

        if (txHash) {
          setTxHash(txHash);
          console.log("✅ Generación de desarrollo ejecutada exitosamente", {
            transactionHash: txHash,
          });
          notification.success(
            `¡5 números aleatorios generados exitosamente! Hash: ${txHash}`,
          );
          if (onSuccess) {
            onSuccess(txHash, generationId);
          }
        }
      } else {
        // Para producción: usar protocolo VRF correcto con multicall
        if (useAlternativeMode) {
          // MODO ALTERNATIVO: Usar parámetros más seguros
          console.log(
            "🔧 Ejecutando en modo ALTERNATIVO con MULTICALL (parámetros seguros)",
            {
              contractAddress,
              seed: seedValue.toString(),
              account: account?.address,
              mode: "alternative_multicall",
            },
          );

          // Usar parámetros más conservadores
          const safeCallbackFeeLimit = "50000"; // Más bajo que el original 100000
          const safePublishDelay = "0";

          const seedHex = num.toHex(seedValue);
          const callbackFeeLimitHex = num.toHex(BigInt(safeCallbackFeeLimit));
          const publishDelayHex = num.toHex(BigInt(safePublishDelay));

          // Crear el source para el VRF usando el seed
          const sourceValue = seedValue;

          // MULTICALL: Dos transacciones según protocolo VRF correcto
          const multicallTx = await writeTransaction([
            // Paso 1: Solicitar aleatoriedad al VRF provider
            {
              contractAddress: VRF_PROVIDER_ADDRESS,
              entrypoint: "request_random",
              calldata: [
                contractAddress as string, // caller (nuestro contrato)
                num.toHex(sourceValue), // source (el seed)
              ],
            },
            // Paso 2: Consumir aleatoriedad en nuestro contrato
            {
              contractAddress: contractAddress as string,
              entrypoint: "request_randomness_prod",
              calldata: [seedHex, callbackFeeLimitHex, publishDelayHex],
            },
          ]);

          if (multicallTx) {
            setTxHash(multicallTx);
            console.log("✅ Multicall alternativo ejecutado exitosamente", {
              transactionHash: multicallTx,
            });
            notification.success(
              `¡Solicitud VRF enviada (Modo Seguro)! Hash: ${multicallTx}. Esperando respuesta del oráculo...`,
            );
            if (onSuccess) {
              onSuccess(multicallTx, generationId);
            }
          }
        } else {
          // MODO NORMAL: Multicall estándar
          console.log(
            "🏭 Ejecutando en modo PRODUCCIÓN con MULTICALL (estándar)",
            {
              contractAddress,
              seed: seedValue.toString(),
              callbackFeeLimit,
              publishDelay,
              account: account?.address,
              mode: "standard_multicall",
            },
          );

          const seedHex = num.toHex(seedValue);
          const callbackFeeLimitHex = num.toHex(BigInt(callbackFeeLimit));
          const publishDelayHex = num.toHex(BigInt(publishDelay));

          // Crear el source para el VRF usando el seed
          const sourceValue = seedValue;

          // MULTICALL: Dos transacciones según protocolo VRF correcto
          const multicallTx = await writeTransaction([
            // Paso 1: Solicitar aleatoriedad al VRF provider
            {
              contractAddress: VRF_PROVIDER_ADDRESS,
              entrypoint: "request_random",
              calldata: [
                contractAddress as string, // caller (nuestro contrato)
                num.toHex(sourceValue), // source (el seed)
              ],
            },
            // Paso 2: Consumir aleatoriedad en nuestro contrato
            {
              contractAddress: contractAddress as string,
              entrypoint: "request_randomness_prod",
              calldata: [seedHex, callbackFeeLimitHex, publishDelayHex],
            },
          ]);

          if (multicallTx) {
            setTxHash(multicallTx);
            console.log("✅ Multicall estándar ejecutado exitosamente", {
              transactionHash: multicallTx,
            });
            notification.success(
              `¡Solicitud VRF enviada! Hash: ${multicallTx}. Esperando respuesta del oráculo...`,
            );
            if (onSuccess) {
              onSuccess(multicallTx, generationId);
            }
          }
        }
      }
    } catch (error: any) {
      console.error("❌ Error ejecutando solicitud de aleatoriedad:", error);

      // 🔍 DIAGNÓSTICO: Información detallada del error
      console.error("🔍 DIAGNÓSTICO - Error detallado:", {
        error: error,
        message: error.message,
        code: error.code,
        data: error.data,
        stack: error.stack,
        contractAddress: contractAddress,
        contractName: contractName,
        account: account?.address,
        chain: chain?.name,
        targetNetwork: targetNetwork.name,
        writeTransactionResult: error.writeTransactionResult,
        transactionHash: error.transactionHash,
        receipt: error.receipt,
        // Información adicional específica de Argent
        isArgentError: error.message?.includes("argent"),
        multicallFailed: error.message?.includes("multicall-failed"),
        entrypointNotFound: error.message?.includes("ENTRYPOINT_NOT_FOUND"),
        entrypointFailed: error.message?.includes("ENTRYPOINT_FAILED"),
      });

      // Proporcionar mensajes de error más específicos
      let errorMessage = "Error desconocido al solicitar aleatoriedad";

      if (
        error.name === "UserRejectedRequestError" ||
        error.message?.includes("User rejected request")
      ) {
        errorMessage =
          "Transacción cancelada por el usuario. Por favor, inténtalo de nuevo.";
      } else if (error.message?.includes("insufficient")) {
        errorMessage =
          "Fondos insuficientes para cubrir los fees de la transacción";
      } else if (error.message?.includes("nonce")) {
        errorMessage = "Error de nonce. Intenta nuevamente";
      } else if (error.message?.includes("network")) {
        errorMessage = "Error de red. Verifica tu conexión";
      } else if (error.message?.includes("ENTRYPOINT_NOT_FOUND")) {
        errorMessage = `❌ ENTRYPOINT_NOT_FOUND: La función no existe en el contrato desplegado.
        Dirección del contrato: ${contractAddress}
        Función intentada: ${chain?.network === "devnet" || targetNetwork.network === "devnet" ? "devnet_generate" : "request_randomness_prod"}
        Posible solución: El contrato necesita ser recompilado y redeployado.`;
      } else if (error.message?.includes("ENTRYPOINT_FAILED")) {
        errorMessage = `❌ ENTRYPOINT_FAILED: Error ejecutando la función del contrato.
        Dirección del contrato: ${contractAddress}
        Función: ${chain?.network === "devnet" || targetNetwork.network === "devnet" ? "devnet_generate" : "request_randomness_prod"}
        Posible solución: Verifica que el contrato esté correctamente inicializado.`;
      } else if (error.message?.includes("argent/multicall-failed")) {
        errorMessage = `❌ ARGENT_MULTICALL_FAILED: Error en multicall VRF.
        Transacciones ejecutadas:
        1. request_random → VRF Provider (${VRF_PROVIDER_ADDRESS})
        2. request_randomness_prod → Contrato (${contractAddress})
        Posible solución: Verifica que el VRF coordinator esté configurado correctamente.`;
      } else if (error.message) {
        errorMessage = `❌ Error específico: ${error.message}`;
      }

      notification.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Verificar que tenemos toda la información necesaria
  if (!contractAddress || !account?.address) {
    return (
      <div className="space-y-6 p-6 bg-component border border-[#8A45FC] rounded-[5px]">
        <div className="text-center text-gray-400">
          <p>Cargando información del contrato...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 bg-component border border-[#8A45FC] rounded-[5px]">
      <div className="space-y-4">
        <h3 className="text-xl font-bold text-white">
          🏆 Multicall VRF - Solicitar Aleatoriedad con Cartridge
        </h3>

        <p className="text-sm text-gray-300">
          {isDevnet ? (
            <>
              Esta función genera 5 números aleatorios únicos en el rango [1,49]
              usando generación local para desarrollo.
            </>
          ) : (
            <>
              Esta función ejecuta un multicall que primero solicita
              aleatoriedad al VRF provider de Cartridge, luego consume esa
              aleatoriedad para generar 5 números únicos en el rango [1,49].
            </>
          )}
        </p>

        {/* Información del contrato */}
        <div className="bg-base-100 p-4 rounded-lg">
          <h4 className="font-semibold mb-2">Contrato Consumidor:</h4>
          <Address address={contractAddress} />
          <div className="mt-2 text-xs text-gray-400">
            <p>
              <strong>Dirección esperada:</strong>{" "}
              0x31cdafdd0fc1a80d57f3290afff3ba0a62e9d2c628e35c81eb55e05879f0f4f
            </p>
            <p>
              <strong>Dirección actual:</strong> {contractAddress}
            </p>
            <p>
              <strong>Red:</strong> {chain?.name || "Desconocida"} →{" "}
              {targetNetwork.name}
            </p>
            <p>
              <strong>Modo:</strong>{" "}
              {isDevnet
                ? "Desarrollo (devnet)"
                : "Producción (testnet/sepolia)"}
            </p>
          </div>
        </div>

        {/* Información técnica */}
        <div
          className={`${isDevnet ? "bg-blue-900/20 border-blue-600" : forceDevMode ? "bg-yellow-900/20 border-yellow-600" : "bg-purple-900/20 border-purple-600"} p-4 rounded-lg`}
        >
          <h4
            className={`font-semibold mb-2 ${isDevnet ? "text-blue-300" : forceDevMode ? "text-yellow-300" : "text-purple-300"}`}
          >
            📋 Modo:{" "}
            {isDevnet
              ? forceDevMode
                ? "Desarrollo Forzado (devnet_generate)"
                : "Desarrollo (Local)"
              : useAlternativeMode
                ? "Producción (Multicall Seguro)"
                : "Producción (Multicall Estándar)"}
          </h4>
          <div className="space-y-1 text-sm">
            {isDevnet ? (
              <>
                <p>
                  <strong>Método:</strong> devnet_generate (generación local)
                </p>
                <p>
                  <strong>Contrato:</strong> {contractAddress}
                </p>
                <p>
                  <strong>Estado:</strong>{" "}
                  {forceDevMode ? "Forzado para testing" : "Automático"}
                </p>
              </>
            ) : (
              <>
                <p>
                  <strong>Método:</strong> Multicall VRF (
                  {useAlternativeMode ? "Modo Seguro" : "Estándar"})
                </p>
                <p>
                  <strong>Transacción 1:</strong> request_random → VRF Provider
                </p>
                <p>
                  <strong>Transacción 2:</strong> request_randomness_prod →
                  Contrato
                </p>
                <p>
                  <strong>VRF Provider:</strong> {VRF_PROVIDER_ADDRESS}
                </p>
                <p>
                  <strong>Callback Fee Limit:</strong>{" "}
                  {useAlternativeMode ? "50,000" : callbackFeeLimit} wei
                </p>
                <p>
                  <strong>Publish Delay:</strong> {publishDelay} (sin delay)
                </p>
                <p>
                  <strong>Source (Seed):</strong> Usado como source para VRF
                </p>
              </>
            )}
          </div>
        </div>

        {/* Formulario de entrada */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Seed (número entero):
            </label>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="12345"
              className="input input-bordered w-full bg-base-100 text-white"
              disabled={isLoading}
            />
            <p className="text-xs text-gray-400 mt-1">
              El seed determina la secuencia aleatoria. Usa diferentes valores
              para obtener resultados diferentes.
            </p>
          </div>

          {/* Estado de conexión */}
          {!isConnected && (
            <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
              <p className="text-red-300 text-sm">
                ⚠️ Wallet no conectado. Conecta tu wallet para usar esta
                función.
              </p>
            </div>
          )}

          {/* Estado de red */}
          {isConnected && writeDisabled && (
            <div className="bg-yellow-900/20 p-3 rounded-lg border border-yellow-600">
              <p className="text-yellow-300 text-sm">
                ⚠️ Wallet conectado a red incorrecta. Cambia a{" "}
                {targetNetwork.name}.
              </p>
            </div>
          )}

          {/* Diagnóstico de problemas potenciales */}
          {contractAddress &&
            contractAddress !==
              "0x31cdafdd0fc1a80d57f3290afff3ba0a62e9d2c628e35c81eb55e05879f0f4f" && (
              <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
                <h4 className="font-semibold text-red-300 mb-2">
                  🚨 Problema Detectado
                </h4>
                <div className="text-sm space-y-1 text-red-200">
                  <p>
                    <strong>Dirección del contrato incorrecta:</strong>
                  </p>
                  <p>
                    • Dirección esperada:
                    0x31cdafdd0fc1a80d57f3290afff3ba0a62e9d2c628e35c81eb55e05879f0f4f
                  </p>
                  <p>• Dirección actual: {contractAddress}</p>
                  <p>
                    • <strong>Solución:</strong> El contrato necesita ser
                    recompilado y redeployado con la dirección correcta.
                  </p>
                </div>
              </div>
            )}

          {/* Diagnóstico específico de problemas de cuenta/wallet */}
          {account?.address &&
            account.address.startsWith(
              "0x0297fd6c19289a017d50b1b65a07ea4db27596a8fade85c6b9622a3f9a24d2a9",
            ) && (
              <div className="bg-red-900/20 p-3 rounded-lg border border-red-600">
                <h4 className="font-semibold text-red-300 mb-2">
                  🚨 Cuenta Problemática Detectada
                </h4>
                <div className="text-sm space-y-2 text-red-200">
                  <p>
                    <strong>
                      Se ha detectado una cuenta que causa errores de
                      transacción.
                    </strong>
                  </p>
                  <div className="bg-red-800/30 p-2 rounded text-xs">
                    <p>
                      <strong>Dirección problemática:</strong>
                    </p>
                    <p className="font-mono break-all">{account.address}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="font-semibold">
                      🔧 Opciones para solucionar:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                      <button
                        className="btn btn-sm bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={() => {
                          // Forzar desconexión y reconexión
                          window.location.reload();
                        }}
                      >
                        🔄 Reconectar Wallet
                      </button>

                      <button
                        className="btn btn-sm bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => {
                          setUseAlternativeMode(true);
                          setSeed("12345");
                          notification.info(
                            "Modo Seguro activado. Intenta generar números con parámetros más conservadores.",
                          );
                        }}
                      >
                        🛡️ Modo Seguro
                      </button>

                      <button
                        className="btn btn-sm bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={() => {
                          // Generar semilla completamente diferente
                          const newSeed = Math.floor(
                            Math.random() * 1000000,
                          ).toString();
                          setSeed(newSeed);
                          notification.info(
                            `Nueva semilla generada: ${newSeed}. Intenta generar números con esta semilla diferente.`,
                          );
                        }}
                      >
                        🎲 Nueva Semilla
                      </button>

                      <button
                        className="btn btn-sm bg-yellow-600 hover:bg-yellow-700 text-white"
                        onClick={() => {
                          setForceDevMode(!forceDevMode);
                          setUseAlternativeMode(false);
                          notification.info(
                            forceDevMode
                              ? "Modo desarrollo desactivado."
                              : "Modo desarrollo forzado activado.",
                          );
                        }}
                      >
                        🔧 {forceDevMode ? "Desactivar" : "Forzar"} Dev Mode
                      </button>
                    </div>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-red-300 hover:text-red-200">
                        Más opciones avanzadas
                      </summary>
                      <div className="mt-2 space-y-1 text-red-300">
                        <p>• Usa una cuenta diferente en tu wallet</p>
                        <p>• Verifica que tienes ETH suficiente para fees</p>
                        <p>• Asegúrate de que la cuenta esté activa</p>
                        <p>• Contacta soporte si el problema persiste</p>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )}

          {/* Información sobre Modo Seguro cuando está activo */}
          {useAlternativeMode && (
            <div className="bg-green-900/20 p-3 rounded-lg border border-green-600">
              <h4 className="font-semibold text-green-300 mb-2">
                ✅ Modo Seguro Activo
              </h4>
              <div className="text-sm space-y-1 text-green-200">
                <p>• Usando parámetros más conservadores (fee limit: 50,000)</p>
                <p>
                  • Probabilidad más alta de éxito con cuentas problemáticas
                </p>
                <p>• Puedes generar números usando el botón principal</p>
                <button
                  className="btn btn-xs bg-red-600 hover:bg-red-700 text-white mt-2"
                  onClick={() => {
                    setUseAlternativeMode(false);
                    notification.info(
                      "Modo Seguro desactivado. Usando parámetros normales.",
                    );
                  }}
                >
                  ❌ Desactivar Modo Seguro
                </button>
              </div>
            </div>
          )}

          {/* Información sobre Modo Desarrollo Forzado cuando está activo */}
          {forceDevMode && (
            <div className="bg-yellow-900/20 p-3 rounded-lg border border-yellow-600">
              <h4 className="font-semibold text-yellow-300 mb-2">
                ⚠️ Modo Desarrollo Forzado
              </h4>
              <div className="text-sm space-y-1 text-yellow-200">
                <p>
                  • Usando función de desarrollo (devnet_generate) incluso en
                  testnet
                </p>
                <p>• Generación local sin depender de oráculos externos</p>
                <p>• Útil para testing cuando hay problemas con VRF</p>
                <button
                  className="btn btn-xs bg-red-600 hover:bg-red-700 text-white mt-2"
                  onClick={() => {
                    setForceDevMode(false);
                    notification.info(
                      "Modo desarrollo desactivado. Usando modo producción.",
                    );
                  }}
                >
                  ❌ Desactivar Modo Dev
                </button>
              </div>
            </div>
          )}

          {/* Estado de cuenta (debugging avanzado) */}
          {isConnected && !writeDisabled && !account?.address && (
            <div className="bg-orange-900/20 p-3 rounded-lg border border-orange-600">
              <p className="text-orange-300 text-sm font-semibold mb-2">
                🔍 Estado de cuenta (debugging):
              </p>
              <div className="text-xs space-y-1">
                <p>
                  <strong>Wallet conectado:</strong> {isConnected ? "Sí" : "No"}
                </p>
                <p>
                  <strong>Dirección de cuenta:</strong>{" "}
                  {account?.address || "No disponible"}
                </p>
                <p>
                  <strong>Estado de wallet:</strong> {walletStatus}
                </p>
                <p>
                  <strong>Red actual:</strong> {chain?.name || "Desconocida"}
                </p>
                <p>
                  <strong>Red objetivo:</strong> {targetNetwork.name}
                </p>
              </div>
              <p className="text-orange-300 text-xs mt-2">
                💡 Si ves esto, intenta reconectar tu wallet o refrescar la
                página.
              </p>
            </div>
          )}

          {/* Resultado de transacción */}
          {txHash && (
            <div className="bg-green-900/20 p-3 rounded-lg border border-green-600">
              <p className="text-green-300 text-sm break-words">
                Hash de transacción: {txHash}
              </p>
            </div>
          )}

          {/* Botón principal */}
          <button
            className={`btn w-full ${
              isLoading || !isConnected || writeDisabled
                ? "btn-disabled"
                : "bg-gradient-dark hover:bg-gradient-dark/80"
            }`}
            onClick={handleRequestRandomness}
            disabled={isLoading || !isConnected || writeDisabled}
          >
            {isLoading && (
              <span className="loading loading-spinner loading-sm mr-2"></span>
            )}
            {isDevnet
              ? "🎲 Generar 5 Números (Desarrollo)"
              : useAlternativeMode
                ? "🔒 Multicall VRF (Modo Seguro)"
                : "🔮 Multicall VRF (Estándar)"}
          </button>
        </div>

        {/* Configuración del VRF Coordinator (solo producción) */}
        {!isDevnet && (
          <VRFCoordinatorConfig contractAddress={contractAddress} />
        )}

        {/* Información adicional */}
        <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-600">
          <h4 className="font-semibold mb-2 text-blue-300">
            💡 Cómo funciona:
          </h4>
          {isDevnet ? (
            <ol className="text-sm space-y-1 text-gray-300">
              <li>
                1. Se llama directamente a <code>devnet_generate(seed)</code>
              </li>
              <li>
                2. El contrato genera 5 números únicos usando un algoritmo LCG
                local
              </li>
              <li>
                3. Los números se generan inmediatamente sin depender de
                oráculos externos
              </li>
              <li>
                4. Los números se almacenan y se pueden consultar con{" "}
                <code>get_generation_numbers(id)</code>
              </li>
            </ol>
          ) : (
            <ol className="text-sm space-y-1 text-gray-300">
              <li>
                1. <strong>Paso 1:</strong> Se ejecuta multicall con 2
                transacciones
              </li>
              <li>
                2. <strong>Transacción 1:</strong>{" "}
                <code>request_random(caller, source)</code> → VRF Provider
              </li>
              <li>
                3. <strong>Transacción 2:</strong>{" "}
                <code>request_randomness_prod(seed, fee, delay)</code> →
                Contrato
              </li>
              <li>
                4. El contrato solicita y consume aleatoriedad usando protocolo
                VRF de Cartridge
              </li>
              <li>
                5. Los números se generan usando aleatoriedad descentralizada
                verificable
              </li>
              <li>
                6. Los números se almacenan y se pueden consultar con{" "}
                <code>get_generation_numbers(id)</code>
              </li>
            </ol>
          )}
        </div>
      </div>
    </div>
  );
};

// Componente para configurar el VRF Coordinator
const VRFCoordinatorConfig = ({
  contractAddress,
}: VRFCoordinatorConfigProps) => {
  const [newCoordinatorAddress, setNewCoordinatorAddress] =
    useState<string>(VRF_PROVIDER_ADDRESS);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const { writeTransaction } = useTransactor();

  const handleUpdateCoordinator = async () => {
    if (
      !newCoordinatorAddress ||
      !newCoordinatorAddress.startsWith("0x") ||
      newCoordinatorAddress.length !== 66
    ) {
      notification.error("Dirección del VRF coordinator inválida");
      return;
    }

    setIsLoading(true);

    try {
      const txHash = await writeTransaction([
        {
          contractAddress: contractAddress as string,
          entrypoint: "set_vrf_coordinator",
          calldata: [newCoordinatorAddress],
        },
      ]);

      if (txHash) {
        notification.success(
          `VRF coordinator actualizado exitosamente! Hash: ${txHash}`,
        );
        setIsExpanded(false);
      }
    } catch (error: any) {
      console.error("Error actualizando VRF coordinator:", error);
      notification.error(
        "Error actualizando VRF coordinator: " +
          (error.message || "Error desconocido"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-orange-900/20 p-4 rounded-lg border border-orange-600">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-orange-300">⚙️ Configuración VRF</h4>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-orange-300 hover:text-orange-200 text-sm"
        >
          {isExpanded ? "▼" : "▶"} {isExpanded ? "Ocultar" : "Mostrar"}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">
            El contrato debe estar configurado con la dirección correcta del VRF
            coordinator de Cartridge.
          </p>

          <div className="space-y-2">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">
                Nueva dirección del VRF Coordinator:
              </label>
              <input
                type="text"
                value={newCoordinatorAddress}
                onChange={(e) => setNewCoordinatorAddress(e.target.value)}
                placeholder="0x..."
                className="input input-bordered w-full bg-base-100 text-white text-sm"
                disabled={isLoading}
              />
            </div>

            <div className="text-xs text-gray-400 space-y-1">
              <p>
                <strong>Dirección actual configurada:</strong>{" "}
                {VRF_PROVIDER_ADDRESS}
              </p>
              <p>
                <strong>Dirección en formulario:</strong>{" "}
                {newCoordinatorAddress}
              </p>
              <p>
                <em>
                  Nota: Solo el owner del contrato puede cambiar esta
                  configuración.
                </em>
              </p>
            </div>

            <button
              onClick={handleUpdateCoordinator}
              disabled={
                isLoading || newCoordinatorAddress === VRF_PROVIDER_ADDRESS
              }
              className={`btn btn-sm w-full ${
                isLoading || newCoordinatorAddress === VRF_PROVIDER_ADDRESS
                  ? "btn-disabled"
                  : "bg-orange-600 hover:bg-orange-700"
              }`}
            >
              {isLoading && (
                <span className="loading loading-spinner loading-xs mr-2"></span>
              )}
              Actualizar VRF Coordinator
            </button>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-orange-300 hover:text-orange-200">
              Información técnica
            </summary>
            <div className="mt-2 space-y-1 text-gray-400 text-xs">
              <p>
                • Esta función llama a <code>set_vrf_coordinator()</code> en el
                contrato
              </p>
              <p>• Solo el owner del contrato puede ejecutar esta función</p>
              <p>
                • El contrato usará esta dirección para validar callbacks del
                VRF
              </p>
              <p>
                • Asegúrate de usar la dirección correcta del VRF provider de
                Cartridge
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
