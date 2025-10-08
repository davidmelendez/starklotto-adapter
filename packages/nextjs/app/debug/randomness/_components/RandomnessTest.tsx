"use client";

import { useState, useEffect } from "react";
import { useNetwork, useContract, useReadContract } from "@starknet-react/core";
import { useAccount } from "~~/hooks/useAccount";
import { useTransactor } from "~~/hooks/scaffold-stark/useTransactor";
import { useTargetNetwork } from "~~/hooks/scaffold-stark/useTargetNetwork";
import { notification } from "~~/utils/scaffold-stark";
import { getAllContracts } from "~~/utils/scaffold-stark/contractsData";
import { Address } from "~~/components/scaffold-stark";
import { Call, CallData, num } from "starknet";

// Dirección del VRF provider de Cartridge en testnet
// IMPORTANTE: Esta dirección debe ser actualizada con la dirección real proporcionada por Cartridge
const VRF_PROVIDER_ADDRESS =
  "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";

export const RandomnessTest = () => {
  const [seed, setSeed] = useState<string>("12345");
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");
  const [generationHistory, setGenerationHistory] = useState<
    Array<{
      id: string;
      seed: string;
      txHash: string;
      timestamp: number;
      numbers?: number[];
    }>
  >([]);

  const { status: walletStatus, isConnected, account, chainId } = useAccount();
  const { chain } = useNetwork();
  const { targetNetwork } = useTargetNetwork();

  // Configuración de parámetros por defecto según requerimientos
  const callbackFeeLimit = "100000"; // 100000 wei como límite de callback
  const publishDelay = "0"; // Sin delay de publicación

  // Obtener datos del contrato desplegado
  const contractsData = getAllContracts();
  const randomnessContract = contractsData.Randomness;

  // Crear instancia del contrato consumidor (siempre, para evitar hooks condicionales)
  const { writeTransaction } = useTransactor();

  if (!randomnessContract) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-red-500">
            Contrato Randomness no encontrado
          </h1>
          <p className="mt-4">
            Asegúrate de que el contrato esté desplegado correctamente.
          </p>
        </div>
      </div>
    );
  }

  const writeDisabled =
    !chain ||
    chain?.network !== targetNetwork.network ||
    walletStatus === "disconnected";

  const handleRequestRandomness = async () => {
    if (!isConnected || writeDisabled) {
      notification.error(
        "Por favor conecta tu wallet y asegúrate de estar en la red correcta",
      );
      return;
    }

    // Agregar debugging avanzado para rastrear errores de Account
    console.log("🔍 Estado de cuenta antes de ejecutar multicall:", {
      isConnected,
      accountAddress: account?.address,
      accountStatus: account ? "connected" : "disconnected",
      walletStatus,
      chainId,
      chainName: chain?.name,
      accountType: typeof account,
      accountKeys: account ? Object.keys(account) : "undefined",
      hasAddress: account?.hasOwnProperty("address"),
      addressType: typeof account?.address,
      accountAddressValid: account?.address && account.address.length > 0,
      accountConstructor: account?.constructor?.name,
      accountPrototype: Object.getPrototypeOf(account)?.constructor?.name,
      timestamp: new Date().toISOString(),
    });

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

    if (!seed || isNaN(Number(seed))) {
      notification.error("Por favor ingresa un seed válido (número entero)");
      return;
    }

    setIsLoading(true);
    setTxHash("");

    try {
      // Convertir seed a u64 (número entero sin signo de 64 bits)
      const seedValue = BigInt(seed);

      // Crear el multicall con dos pasos:
      // 1. Llamar al VRF provider: request_random(caller, Source::Salt(seed))
      // 2. Llamar al contrato consumidor: request_randomness_prod(seed, fee_limit, delay)

      const seedHex = num.toHex(seedValue);
      const callbackFeeLimitHex = num.toHex(BigInt(callbackFeeLimit));
      const publishDelayHex = num.toHex(BigInt(publishDelay));

      const requestCalldata = [
        randomnessContract.address,
        "0x1",
        num.toHex(seedValue),
      ];

      const calls: Call[] = [
        {
          contractAddress: VRF_PROVIDER_ADDRESS,
          entrypoint: "request_random",
          calldata: requestCalldata,
        },
        {
          contractAddress: randomnessContract.address,
          entrypoint: "request_randomness_prod",
          calldata: [seedHex, callbackFeeLimitHex, publishDelayHex],
        },
      ];

      console.log("Calldata VRF", requestCalldata);

      console.log("Solicitando aleatoriedad via multicall", {
        vrfProvider: VRF_PROVIDER_ADDRESS,
        consumerContract: randomnessContract.address,
        seed,
        callbackFeeLimit,
        publishDelay,
        account: account?.address,
        caller: randomnessContract.address,
        calls,
      });

      // Ejecutar el multicall
      const txHash = await writeTransaction(calls);

      if (txHash) {
        setTxHash(txHash);

        const historyEntry = {
          id: Date.now().toString(),
          seed,
          txHash,
          timestamp: Date.now(),
        };

        setGenerationHistory((prev) => [historyEntry, ...prev]);

        console.log("Multicall ejecutado exitosamente", {
          transactionHash: txHash,
        });

        notification.success(
          `Aleatoriedad solicitada exitosamente! Hash: ${txHash}`,
        );

        setTimeout(() => {
          setTxHash("");
        }, 5000);
      }
    } catch (error: any) {
      console.error("❌ Error ejecutando multicall de aleatoriedad:", error);

      // Proporcionar mensajes de error más específicos
      let errorMessage = "Error desconocido al solicitar aleatoriedad";

      if (
        error.name === "UserRejectedRequestError" ||
        error.message?.includes("User rejected request")
      ) {
        errorMessage =
          "Transacción cancelada por el usuario. Por favor, inténtalo de nuevo.";
        console.log("ℹ️ Usuario canceló la transacción en la wallet");
      } else if (error.message?.includes("insufficient")) {
        errorMessage =
          "Fondos insuficientes para cubrir los fees de la transacción";
      } else if (error.message?.includes("nonce")) {
        errorMessage = "Error de nonce. Intenta nuevamente";
      } else if (error.message?.includes("network")) {
        errorMessage = "Error de red. Verifica tu conexión";
      } else if (error.message?.includes("VRF")) {
        errorMessage = "Error con el servicio VRF. Verifica la configuración";
      } else if (error.message) {
        errorMessage = error.message;
      }

      notification.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGenerationNumbers = async (generationId: string) => {
    // TODO: Implementar lectura de números usando useScaffoldReadContract
    // Por ahora, esta función está deshabilitada hasta implementar correctamente
    // la integración con el contrato para leer get_generation_numbers
    notification.info(
      "Función de lectura de números en desarrollo. Usa el debug UI para consultar el contrato directamente.",
    );
    console.log(
      "📊 Solicitud para obtener números de generación:",
      generationId,
    );
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          🏆 Test de Aleatoriedad con Cartridge VRF
        </h1>
        <p className="text-gray-300 text-lg">
          Prueba la generación de números aleatorios usando el servicio VRF de
          Cartridge
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Panel de Control */}
        <div className="space-y-6">
          <div className="bg-component border border-[#8A45FC] rounded-[5px] p-6">
            <h2 className="text-2xl font-bold text-white mb-4">
              🎲 Generar Números Aleatorios
            </h2>

            <p className="text-sm text-gray-300 mb-6">
              Esta función ejecuta un multicall que primero solicita
              aleatoriedad al VRF provider de Cartridge, luego consume esa
              aleatoriedad en el contrato para generar 5 números únicos en el
              rango [1,49].
            </p>

            {/* Información del contrato */}
            <div className="bg-base-100 p-4 rounded-lg mb-6">
              <h4 className="font-semibold mb-2">Contrato Consumidor:</h4>
              <Address address={randomnessContract.address} />
            </div>

            {/* Información técnica */}
            <div className="bg-yellow-900/20 p-4 rounded-lg border border-yellow-600 mb-6">
              <h4 className="font-semibold mb-2 text-yellow-300">
                📋 Parámetros del Multicall:
              </h4>
              <div className="space-y-1 text-sm">
                <p>
                  <strong>VRF Provider:</strong> {VRF_PROVIDER_ADDRESS}
                </p>
                <p>
                  <strong>Callback Fee Limit:</strong> {callbackFeeLimit} wei
                </p>
                <p>
                  <strong>Publish Delay:</strong> {publishDelay} (sin delay)
                </p>
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
                  El seed determina la secuencia aleatoria. Usa diferentes
                  valores para obtener resultados diferentes.
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

              {/* Estado de cuenta (debugging avanzado) */}
              {isConnected && !writeDisabled && !account?.address && (
                <div className="bg-orange-900/20 p-3 rounded-lg border border-orange-600">
                  <p className="text-orange-300 text-sm font-semibold mb-2">
                    🔍 Estado de cuenta (debugging):
                  </p>
                  <div className="text-xs space-y-1">
                    <p>
                      <strong>Wallet conectado:</strong>{" "}
                      {isConnected ? "Sí" : "No"}
                    </p>
                    <p>
                      <strong>Dirección de cuenta:</strong>{" "}
                      {account?.address || "No disponible"}
                    </p>
                    <p>
                      <strong>Estado de wallet:</strong> {walletStatus}
                    </p>
                    <p>
                      <strong>Red actual:</strong>{" "}
                      {chain?.name || "Desconocida"}
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
                🎲 Solicitar 5 Números Aleatorios
              </button>
            </div>
          </div>

          {/* Información adicional */}
          <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-600">
            <h4 className="font-semibold mb-2 text-blue-300">
              💡 Cómo funciona:
            </h4>
            <ol className="text-sm space-y-1 text-gray-300">
              <li>1. Se ejecuta un multicall con dos pasos</li>
              <li>
                2. Primero se solicita aleatoriedad al VRF provider de Cartridge
              </li>
              <li>
                3. Luego se consume esa aleatoriedad en el contrato para generar
                5 números únicos [1,49]
              </li>
              <li>
                4. Los números se almacenan en el contrato y se puede consultar
                usando get_generation_numbers(id)
              </li>
            </ol>
          </div>
        </div>

        {/* Panel de Historial */}
        <div className="bg-component border border-[#8A45FC] rounded-[5px] p-6">
          <h2 className="text-2xl font-bold text-white mb-4">
            📚 Historial de Generaciones
          </h2>

          {generationHistory.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <p>No hay generaciones aún</p>
              <p className="text-sm mt-2">
                Ejecuta la función para ver el historial aquí
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {generationHistory.map((entry) => (
                <div key={entry.id} className="bg-base-100 p-4 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold">Seed: {entry.seed}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(entry.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => fetchGenerationNumbers(entry.id)}
                    >
                      Obtener Números
                    </button>
                  </div>

                  <p className="text-xs text-gray-400 mb-2">
                    Tx: {entry.txHash.substring(0, 10)}...
                    {entry.txHash.substring(entry.txHash.length - 8)}
                  </p>

                  {entry.numbers && (
                    <div className="bg-green-900/20 p-2 rounded border border-green-600">
                      <p className="text-green-300 text-sm font-semibold">
                        Números: {entry.numbers.join(", ")}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Información de Debug */}
      <div className="mt-8 bg-gray-900/50 p-6 rounded-lg border border-gray-600">
        <h3 className="text-lg font-semibold text-white mb-4">
          🔧 Información de Debug
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p>
              <strong>Estado de Wallet:</strong> {walletStatus}
            </p>
            <p>
              <strong>Conectado:</strong> {isConnected ? "Sí" : "No"}
            </p>
            <p>
              <strong>Red Actual:</strong> {chain?.name || "Ninguna"}
            </p>
          </div>
          <div>
            <p>
              <strong>Red Objetivo:</strong> {targetNetwork.name}
            </p>
            <p>
              <strong>Contrato:</strong> {randomnessContract.address}
            </p>
            <p>
              <strong>Cuenta:</strong> {account?.address?.substring(0, 10)}...
              {account?.address?.substring(account.address.length - 8)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
