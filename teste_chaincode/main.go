package main

import (
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type SmartContract struct {
	contractapi.Contract
}

type StoreResult struct {
	ElapsedMs float64 `json:"elapsed_ms"`
}

// ---------------------------------------------------------------------------
// Helpers de chave composta e timing
// ---------------------------------------------------------------------------

func pubKeyCompositeKey(ctx contractapi.TransactionContextInterface, username string) (string, error) {
	return ctx.GetStub().CreateCompositeKey("pubkey", []string{username})
}

func timingEnabled(ctx contractapi.TransactionContextInterface) bool {
	data, err := ctx.GetStub().GetState("timing_flag")
	if err != nil || data == nil {
		// por padrão, timing está ATIVADO
		return true
	}
	return string(data) == "true"
}

// ===========================================================================
// FUNÇÕES DO CHAINCODE
// ===========================================================================

// Store armazena um valor simples (sem verificação de assinatura).
func (s *SmartContract) Store(ctx contractapi.TransactionContextInterface, key string, value string) (string, error) {
	start := time.Now()
	if key == "" || value == "" {
		return "", fmt.Errorf("key e value são obrigatórios")
	}
	err := ctx.GetStub().PutState(key, []byte(value))
	elapsed := time.Since(start).Seconds() * 1000
	if err != nil {
		return "", err
	}
	if !timingEnabled(ctx) {
		return "{}", nil
	}
	res := StoreResult{ElapsedMs: elapsed}
	resBytes, _ := json.Marshal(res)
	return string(resBytes), nil
}

// StoreSigned armazena um valor após verificar a assinatura ECDSA do valor,
// utilizando a chave pública do usuário indicado.
func (s *SmartContract) StoreSigned(ctx contractapi.TransactionContextInterface,
	username, key, value, signatureB64 string) (string, error) {
	start := time.Now()
	if username == "" || key == "" || value == "" || signatureB64 == "" {
		return "", fmt.Errorf("username, key, value e signatureB64 são obrigatórios")
	}

	// Obtém a chave composta para a chave pública do usuário
	pubKeyComposite, err := pubKeyCompositeKey(ctx, username)
	if err != nil {
		return "", fmt.Errorf("erro ao criar chave composta: %v", err)
	}

	// Busca a chave pública do usuário
	pubKeyPEM, err := ctx.GetStub().GetState(pubKeyComposite)
	if err != nil {
		return "", fmt.Errorf("erro ao buscar chave pública: %v", err)
	}
	if pubKeyPEM == nil {
		return "", fmt.Errorf("chave pública de %s não encontrada. Use StoreUserPubKey primeiro", username)
	}

	block, _ := pem.Decode(pubKeyPEM)
	if block == nil || block.Type != "PUBLIC KEY" {
		return "", fmt.Errorf("formato de chave pública inválido")
	}

	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("erro ao fazer parse da chave pública: %v", err)
	}

	ecPubKey, ok := pubKey.(*ecdsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("chave pública não é do tipo ECDSA")
	}

	signatureBytes, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		return "", fmt.Errorf("assinatura em Base64 inválida: %v", err)
	}

	hash := sha256.Sum256([]byte(value))
	if !ecdsa.VerifyASN1(ecPubKey, hash[:], signatureBytes) {
		return "", fmt.Errorf("assinatura inválida")
	}

	err = ctx.GetStub().PutState(key, []byte(value))
	elapsed := time.Since(start).Seconds() * 1000
	if err != nil {
		return "", err
	}
	if !timingEnabled(ctx) {
		return "{}", nil
	}
	res := StoreResult{ElapsedMs: elapsed}
	resBytes, _ := json.Marshal(res)
	return string(resBytes), nil
}

// Query recupera um valor armazenado no ledger.
func (s *SmartContract) Query(ctx contractapi.TransactionContextInterface, key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("key não pode ser vazia")
	}
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return "", fmt.Errorf("erro ao acessar o ledger: %v", err)
	}
	if data == nil {
		return "", fmt.Errorf("registro '%s' não encontrado", key)
	}
	return string(data), nil
}

// StoreUserPubKey armazena a chave pública de um determinado usuário.
func (s *SmartContract) StoreUserPubKey(ctx contractapi.TransactionContextInterface,
	username, pubKeyPEM string) error {
	if username == "" || pubKeyPEM == "" {
		return fmt.Errorf("username e pubKeyPEM são obrigatórios")
	}

	block, _ := pem.Decode([]byte(pubKeyPEM))
	if block == nil || block.Type != "PUBLIC KEY" {
		return fmt.Errorf("formato de chave pública inválido")
	}

	key, err := pubKeyCompositeKey(ctx, username)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(key, []byte(pubKeyPEM))
}

// VerifySignature verifica se uma assinatura é válida para uma mensagem,
// usando a chave pública do usuário indicado.
func (s *SmartContract) VerifySignature(ctx contractapi.TransactionContextInterface,
	username, message, signatureB64 string) (bool, error) {
	if username == "" || message == "" || signatureB64 == "" {
		return false, fmt.Errorf("username, message e signatureB64 são obrigatórios")
	}

	pubKeyComposite, err := pubKeyCompositeKey(ctx, username)
	if err != nil {
		return false, fmt.Errorf("erro ao criar chave composta: %v", err)
	}

	pubKeyPEM, err := ctx.GetStub().GetState(pubKeyComposite)
	if err != nil {
		return false, fmt.Errorf("erro ao buscar chave pública: %v", err)
	}
	if pubKeyPEM == nil {
		return false, fmt.Errorf("chave pública de %s não encontrada", username)
	}

	block, _ := pem.Decode(pubKeyPEM)
	if block == nil || block.Type != "PUBLIC KEY" {
		return false, fmt.Errorf("formato de chave pública inválido")
	}

	pubKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return false, fmt.Errorf("erro ao fazer parse da chave pública: %v", err)
	}

	ecPubKey, ok := pubKey.(*ecdsa.PublicKey)
	if !ok {
		return false, fmt.Errorf("chave pública não é ECDSA")
	}

	signatureBytes, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		return false, fmt.Errorf("assinatura Base64 inválida: %v", err)
	}

	hash := sha256.Sum256([]byte(message))
	return ecdsa.VerifyASN1(ecPubKey, hash[:], signatureBytes), nil
}

// SetTiming ativa ou desativa a medição de tempo nas funções Store e StoreSigned.
// Quando desativado, as funções retornam apenas "{}", permitindo múltiplos endorsers.
func (s *SmartContract) SetTiming(ctx contractapi.TransactionContextInterface, enable bool) error {
	val := "false"
	if enable {
		val = "true"
	}
	return ctx.GetStub().PutState("timing_flag", []byte(val))
}

func main() {
	chaincode, err := contractapi.NewChaincode(new(SmartContract))
	if err != nil {
		panic(fmt.Sprintf("erro criando chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("erro iniciando chaincode: %v", err))
	}
}