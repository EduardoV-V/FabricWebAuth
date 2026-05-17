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

func (s *SmartContract) Store(ctx contractapi.TransactionContextInterface, key string, value string) (string, error) {
	start := time.Now()
	if key == "" {
		return "", fmt.Errorf("key não pode ser vazia")
	}
	if value == "" {
		return "", fmt.Errorf("value não pode ser vazio")
	}
	err := ctx.GetStub().PutState(key, []byte(value))
	elapsed := time.Since(start).Seconds() * 1000
	if err != nil {
		return "", err
	}
	res := StoreResult{ElapsedMs: elapsed}
	resBytes, _ := json.Marshal(res)
	return string(resBytes), nil
}

func (s *SmartContract) StoreSigned(ctx contractapi.TransactionContextInterface, key string, value string, signatureB64 string) (string, error) {
	start := time.Now()
	if key == "" || value == "" || signatureB64 == "" {
		return "", fmt.Errorf("key, value e signatureB64 são obrigatórios")
	}

	pubKeyPEM, err := ctx.GetStub().GetState("pubkey")
	if err != nil {
		return "", fmt.Errorf("erro ao buscar chave pública: %v", err)
	}
	if pubKeyPEM == nil {
		return "", fmt.Errorf("chave pública não encontrada. Use StoreUserPubKey primeiro")
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

	valid := ecdsa.VerifyASN1(ecPubKey, hash[:], signatureBytes)
	if !valid {
		return "", fmt.Errorf("assinatura inválida")
	}

	err = ctx.GetStub().PutState(key, []byte(value))
	elapsed := time.Since(start).Seconds() * 1000
	if err != nil {
		return "", err
	}
	res := StoreResult{ElapsedMs: elapsed}
	resBytes, _ := json.Marshal(res)
	return string(resBytes), nil
}

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

func (s *SmartContract) StoreUserPubKey(ctx contractapi.TransactionContextInterface, pubKeyPEM string) error {
	if pubKeyPEM == "" {
		return fmt.Errorf("pubKeyPEM não pode ser vazio")
	}

	block, _ := pem.Decode([]byte(pubKeyPEM))
	if block == nil || block.Type != "PUBLIC KEY" {
		return fmt.Errorf("formato de chave pública inválido")
	}

	return ctx.GetStub().PutState("pubkey", []byte(pubKeyPEM))
}

func (s *SmartContract) VerifySignature(ctx contractapi.TransactionContextInterface, message string, signatureB64 string) (bool, error) {
	if message == "" || signatureB64 == "" {
		return false, fmt.Errorf("message e signatureB64 são obrigatórios")
	}

	pubKeyPEM, err := ctx.GetStub().GetState("pubkey")
	if err != nil {
		return false, fmt.Errorf("erro ao buscar chave pública: %v", err)
	}
	if pubKeyPEM == nil {
		return false, fmt.Errorf("chave pública não encontrada")
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
	valid := ecdsa.VerifyASN1(ecPubKey, hash[:], signatureBytes)
	return valid, nil
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