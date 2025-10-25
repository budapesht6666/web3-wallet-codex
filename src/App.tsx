import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Wallet } from "lucide-react";
import {
  BrowserProvider,
  Contract,
  Eip1193Provider,
  TransactionReceipt,
  formatUnits,
  isAddress,
  parseUnits
} from "ethers";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ARB_TOKEN_ADDRESS = "0x912CE59144191C1204E64559FE8253a0e49E6548";
const ARB_TOKEN_DECIMALS = 18;
const ARBITRUM_GOERLI_CHAIN_ID = 421_613;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

type EthereumWithEvents = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type ConnectionState = {
  provider?: BrowserProvider;
  signerAddress?: string;
  chainId?: number;
  balance?: string;
  rawBalance?: bigint;
  tokenSymbol?: string;
};

type SubmissionStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success"; receipt: TransactionReceipt }
  | { state: "error"; message: string };

declare global {
  interface Window {
    ethereum?: EthereumWithEvents;
  }
}

export default function App() {
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({});
  const [isConnecting, setIsConnecting] = useState(false);
  const [submission, setSubmission] = useState<SubmissionStatus>({ state: "idle" });
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [formErrors, setFormErrors] = useState<{ recipient?: string; amount?: string }>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const isWrongNetwork = useMemo(() => {
    return connection.chainId !== undefined && connection.chainId !== ARBITRUM_GOERLI_CHAIN_ID;
  }, [connection.chainId]);

  const explorerUrl = useMemo(() => {
    if (submission.state !== "success") return null;
    return `https://goerli.arbiscan.io/tx/${submission.receipt.hash}`;
  }, [submission]);

  const resetSubmission = useCallback(() => {
    if (submission.state !== "idle") {
      setSubmission({ state: "idle" });
    }
  }, [submission.state]);

  const fetchBalance = useCallback(
    async (provider: BrowserProvider, address: string) => {
      const signer = await provider.getSigner();
      const contract = new Contract(ARB_TOKEN_ADDRESS, ERC20_ABI, signer);
      const [rawBalance, decimals, symbol] = await Promise.all([
        contract.balanceOf(address) as Promise<bigint>,
        contract.decimals() as Promise<number>,
        contract.symbol() as Promise<string>
      ]);

      const formatted = formatUnits(rawBalance, decimals ?? ARB_TOKEN_DECIMALS);
      setConnection((prev) => ({
        ...prev,
        balance: formatted,
        rawBalance,
        tokenSymbol: symbol ?? "ARB"
      }));
    },
    []
  );

  const handleAccountsChanged = useCallback(
    async (accounts: string[]) => {
      if (!accounts.length) {
        setConnection({});
        setSubmission({ state: "idle" });
        setRecipient("");
        setAmount("");
        return;
      }

      if (!window.ethereum) return;
      const provider = new BrowserProvider(window.ethereum, "any");
      const network = await provider.getNetwork();
      const signerAddress = accounts[0];

      setConnection((prev) => ({
        ...prev,
        provider,
        signerAddress,
        chainId: Number(network.chainId)
      }));
      await fetchBalance(provider, signerAddress);
    },
    [fetchBalance]
  );

  const handleChainChanged = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new BrowserProvider(window.ethereum, "any");
    const network = await provider.getNetwork();
    const signer = await provider.getSigner().catch(() => null);
    const signerAddress = signer ? await signer.getAddress() : undefined;

    setConnection((prev) => ({
      ...prev,
      provider,
      signerAddress,
      chainId: Number(network.chainId)
    }));

    if (signerAddress) {
      await fetchBalance(provider, signerAddress);
    }
  }, [fetchBalance]);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setGlobalError("Установите MetaMask, чтобы продолжить.");
      return;
    }

    setIsConnecting(true);
    setGlobalError(null);
    try {
      const provider = new BrowserProvider(window.ethereum, "any");
      const accounts = await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      setConnection({
        provider,
        signerAddress,
        chainId: Number(network.chainId)
      });

      await fetchBalance(provider, signerAddress);
    } catch (error: unknown) {
      if ((error as Error)?.message?.includes("User rejected")) {
        setGlobalError("Подключение отменено пользователем.");
      } else {
        setGlobalError("Не удалось подключить кошелёк.");
      }
    } finally {
      setIsConnecting(false);
    }
  }, [fetchBalance]);

  useEffect(() => {
    const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
    setHasProvider(typeof window !== "undefined" && Boolean(ethereum));

    if (!ethereum) {
      return;
    }

    const onAccountsChanged = (accounts: unknown) => {
      if (Array.isArray(accounts)) {
        void handleAccountsChanged(accounts as string[]);
      }
    };

    const onChainChanged = () => {
      void handleChainChanged();
    };

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [handleAccountsChanged, handleChainChanged]);

  const validateForm = useCallback(() => {
    const errors: { recipient?: string; amount?: string } = {};

    if (!recipient.trim()) {
      errors.recipient = "Введите адрес получателя.";
    } else if (!isAddress(recipient.trim())) {
      errors.recipient = "Указан некорректный адрес.";
    }

    if (!amount.trim()) {
      errors.amount = "Введите сумму перевода.";
    } else {
      const numericAmount = Number(amount);
      if (Number.isNaN(numericAmount) || numericAmount <= 0) {
        errors.amount = "Сумма должна быть положительным числом.";
      } else if (connection.rawBalance !== undefined) {
        try {
          const parsed = parseUnits(amount, ARB_TOKEN_DECIMALS);
          if (parsed > connection.rawBalance) {
            errors.amount = "Недостаточно средств для перевода.";
          }
        } catch (error) {
          errors.amount = "Не удалось обработать сумму. Проверьте формат.";
        }
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [amount, connection.rawBalance, recipient]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetSubmission();
      setGlobalError(null);

      if (!connection.provider || !connection.signerAddress) {
        setGlobalError("Подключите кошелёк, чтобы отправить транзакцию.");
        return;
      }

      if (isWrongNetwork) {
        setGlobalError("Переключитесь на сеть Arbitrum Goerli.");
        return;
      }

      const isValid = validateForm();
      if (!isValid) {
        return;
      }

      try {
        setSubmission({ state: "submitting" });
        const signer = await connection.provider.getSigner();
        const contract = new Contract(ARB_TOKEN_ADDRESS, ERC20_ABI, signer);
        const parsedAmount = parseUnits(amount, ARB_TOKEN_DECIMALS);
        const tx = await contract.transfer(recipient.trim(), parsedAmount);

        const receipt = await tx.wait();
        if (!receipt) {
          throw new Error("Ошибка транзакции.");
        }
        setSubmission({ state: "success", receipt });
        await fetchBalance(connection.provider, connection.signerAddress);
      } catch (error: unknown) {
        const message = (error as Error)?.message ?? "Ошибка транзакции.";
        if (message.toLowerCase().includes("user rejected")) {
          setSubmission({ state: "error", message: "Транзакция отменена." });
        } else {
          setSubmission({ state: "error", message: "Ошибка транзакции." });
        }
      }
    },
    [
      amount,
      connection.provider,
      connection.signerAddress,
      fetchBalance,
      isWrongNetwork,
      recipient,
      resetSubmission,
      validateForm
    ]
  );

  useEffect(() => {
    if (!amount) {
      setFormErrors((prev) => ({ ...prev, amount: undefined }));
    }
  }, [amount]);

  const walletStatus = useMemo(() => {
    if (hasProvider === false) {
      return "MetaMask не установлен";
    }
    if (!connection.signerAddress) {
      return "Кошелёк не подключен";
    }
    if (isWrongNetwork) {
      return "Неверная сеть";
    }
    return "Готов к отправке";
  }, [connection.signerAddress, hasProvider, isWrongNetwork]);

  const isFormDisabled =
    !connection.signerAddress || isWrongNetwork || submission.state === "submitting";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-muted/40 via-background to-background px-4 py-10">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
              <Wallet className="h-6 w-6" />
              ARB Transfer
            </CardTitle>
            <CardDescription>
              Отправляйте тестовые токены ARB в сети Arbitrum Goerli.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <p className="text-sm text-muted-foreground">Статус: {walletStatus}</p>
              {connection.signerAddress && (
                <div className="space-y-1 text-sm">
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    Адрес: {connection.signerAddress}
                  </p>
                  {connection.balance !== undefined && connection.tokenSymbol && (
                    <p>
                      Баланс: {parseFloat(connection.balance).toLocaleString(undefined, {
                        maximumFractionDigits: 4
                      })}{" "}
                      {connection.tokenSymbol}
                    </p>
                  )}
                </div>
              )}
            </section>

            {hasProvider === false && (
              <Alert variant="destructive">
                <AlertTitle>MetaMask не найден</AlertTitle>
                <AlertDescription>
                  Установите расширение MetaMask, чтобы подключиться к сети Arbitrum Goerli.
                </AlertDescription>
              </Alert>
            )}

            {isWrongNetwork && (
              <Alert variant="destructive">
                <AlertTitle>Неверная сеть</AlertTitle>
                <AlertDescription>
                  Переключитесь на Arbitrum Goerli в MetaMask, чтобы продолжить.
                </AlertDescription>
              </Alert>
            )}

            {globalError && (
              <Alert variant="destructive">
                <AlertTitle>Ошибка</AlertTitle>
                <AlertDescription>{globalError}</AlertDescription>
              </Alert>
            )}

            {!connection.signerAddress && hasProvider !== false && (
              <Button onClick={() => void connectWallet()} disabled={isConnecting} className="w-full">
                {isConnecting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Подключение...
                  </span>
                ) : (
                  "Подключить кошелёк"
                )}
              </Button>
            )}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="recipient">Адрес получателя</Label>
                <Input
                  id="recipient"
                  placeholder="0x..."
                  value={recipient}
                  onChange={(event) => {
                    setRecipient(event.target.value);
                    resetSubmission();
                    if (formErrors.recipient) {
                      setFormErrors((prev) => ({ ...prev, recipient: undefined }));
                    }
                  }}
                  disabled={isFormDisabled}
                  autoComplete="off"
                />
                {formErrors.recipient && (
                  <p className="flex items-center gap-2 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {formErrors.recipient}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Сумма в ARB</Label>
                <Input
                  id="amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  placeholder="0.1"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    resetSubmission();
                    if (formErrors.amount) {
                      setFormErrors((prev) => ({ ...prev, amount: undefined }));
                    }
                  }}
                  disabled={isFormDisabled}
                />
                {formErrors.amount && (
                  <p className="flex items-center gap-2 text-xs text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {formErrors.amount}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className={cn("w-full", submission.state === "success" && "bg-emerald-600 hover:bg-emerald-600")}
                disabled={isFormDisabled}
              >
                {submission.state === "submitting" ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Отправка...
                  </span>
                ) : submission.state === "success" ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Успешно отправлено
                  </span>
                ) : (
                  "Отправить"
                )}
              </Button>
            </form>

            {submission.state === "success" && explorerUrl && (
              <Alert>
                <AlertTitle>Транзакция отправлена</AlertTitle>
                <AlertDescription>
                  <a
                    href={explorerUrl}
                    className="inline-flex items-center gap-1 text-primary underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Просмотреть в Arbiscan
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </AlertDescription>
              </Alert>
            )}

            {submission.state === "error" && (
              <Alert variant="destructive">
                <AlertTitle>Транзакция не выполнена</AlertTitle>
                <AlertDescription>{submission.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
