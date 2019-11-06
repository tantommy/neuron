import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { RouteComponentProps } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Stack, Text, DefaultButton, Icon, TooltipHost, Spinner } from 'office-ui-fabric-react'

import appState from 'states/initStates/app'
import { AppActions, StateWithDispatch } from 'states/stateProvider/reducer'
import { updateNervosDaoData, clearNervosDaoData } from 'states/stateProvider/actionCreators'

import calculateFee from 'utils/calculateFee'
import { shannonToCKBFormatter } from 'utils/formatters'
import { MIN_DEPOSIT_AMOUNT, MEDIUM_FEE_RATE, SHANNON_CKB_RATIO } from 'utils/const'

import { generateDepositTx, generateWithdrawTx, generateClaimTx } from 'services/remote'
import { epochParser } from 'utils/parsers'

import DAORecord from 'components/CustomRows/DAORecordRow'

import DepositDialog from './DepositDialog'
import WithdrawDialog from './WithdrawDialog'

let timer: NodeJS.Timeout

const NervosDAO = ({
  app: {
    send = appState.send,
    loadings: { sending = false },
    tipBlockNumber,
    tipBlockHash,
    epoch,
  },
  wallet,
  dispatch,
  nervosDAO: { records },
}: React.PropsWithoutRef<StateWithDispatch & RouteComponentProps>) => {
  const [t] = useTranslation()
  const [depositValue, setDepositValue] = useState(`${MIN_DEPOSIT_AMOUNT}`)
  const [showDepositDialog, setShowDepositDialog] = useState(false)
  const [activeRecord, setActiveRecord] = useState<State.NervosDAORecord | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const clearGeneratedTx = useCallback(() => {
    dispatch({
      type: AppActions.ClearSendState,
      payload: null,
    })
  }, [dispatch])

  const updateDepositValue = useCallback(
    (value: string) => {
      if (Number.isNaN(+value) || /[^\d.]/.test(value) || +value < 0) {
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (+value < MIN_DEPOSIT_AMOUNT) {
          setErrorMessage(t('nervos-dao.minimal-fee-required', { minimal: MIN_DEPOSIT_AMOUNT }))
          clearGeneratedTx()
        } else {
          setErrorMessage('')
          generateDepositTx({
            feeRate: `${MEDIUM_FEE_RATE}`,
            capacity: (BigInt(value) * BigInt(SHANNON_CKB_RATIO)).toString(),
            walletID: wallet.id,
          }).then(res => {
            if (res.status === 1) {
              dispatch({
                type: AppActions.UpdateGeneratedTx,
                payload: res.result,
              })
            } else {
              clearGeneratedTx()
              setErrorMessage(`${typeof res.message === 'string' ? res.message : res.message.content}`)
            }
          })
        }
      }, 500)
      setDepositValue(value)
    },
    [clearGeneratedTx, dispatch, wallet.id]
  )

  useEffect(() => {
    updateNervosDaoData({ walletID: wallet.id })(dispatch)
    updateDepositValue(`${MIN_DEPOSIT_AMOUNT}`)
    return () => {
      clearNervosDaoData()(dispatch)
      clearGeneratedTx()
    }
  }, [clearGeneratedTx, dispatch, updateDepositValue, wallet.id])

  const onDepositDialogDismiss = () => {
    setShowDepositDialog(false)
    setDepositValue(`${MIN_DEPOSIT_AMOUNT}`)
    setErrorMessage('')
  }

  const onDepositDialogSubmit = () => {
    setShowDepositDialog(false)
    setDepositValue(`${MIN_DEPOSIT_AMOUNT}`)
    dispatch({
      type: AppActions.RequestPassword,
      payload: {
        walletID: wallet.id,
        actionType: 'send',
      },
    })
  }

  const onWithdrawDialogDismiss = () => {
    setActiveRecord(null)
  }

  const onWithdrawDialogSubmit = () => {
    setErrorMessage('')
    if (activeRecord) {
      ;(activeRecord.depositOutPoint
        ? generateClaimTx({
            walletID: wallet.id,
            withdrawingOutPoint: activeRecord.outPoint,
            depositOutPoint: activeRecord.depositOutPoint,
            feeRate: `${MEDIUM_FEE_RATE}`,
          })
        : generateWithdrawTx({
            walletID: wallet.id,
            outPoint: activeRecord.outPoint,
            feeRate: `${MEDIUM_FEE_RATE}`,
          })
      )
        .then((res: any) => {
          if (res.status === 1) {
            dispatch({
              type: AppActions.UpdateGeneratedTx,
              payload: res.result,
            })
            dispatch({
              type: AppActions.RequestPassword,
              payload: {
                walletID: wallet.id,
                actionType: 'send',
              },
            })
          } else {
            clearGeneratedTx()
            setErrorMessage(`${typeof res.message === 'string' ? res.message : res.message.content}`)
          }
        })
        .catch((err: Error) => {
          dispatch({
            type: AppActions.AddNotification,
            payload: {
              type: 'alert',
              timestamp: +new Date(),
              content: err.message,
            },
          })
        })
    }
    setActiveRecord(null)
  }

  const onActionClick = useCallback(
    (e: any) => {
      const { dataset } = e.target
      const outPoint = {
        txHash: dataset.txHash,
        index: dataset.index,
      }
      const record = records.find(r => r.outPoint.txHash === outPoint.txHash && r.outPoint.index === outPoint.index)
      if (record) {
        setActiveRecord(record)
      }
    },
    [records]
  )

  const fee = `${shannonToCKBFormatter(
    send.generatedTx ? send.generatedTx.fee || calculateFee(send.generatedTx) : '0'
  )} CKB`

  const Records = useMemo(() => {
    return (
      <>
        <Text as="h2" variant="xxLarge">
          {t('nervos-dao.deposit-records')}
        </Text>
        <Stack>
          {records.map(record => {
            let stage = 'deposited'
            if (record.depositOutPoint) {
              stage = 'withdrawing'
            }
            return (
              <DAORecord
                {...record}
                actionLabel={t(`nervos-dao.${stage}-action-label`)}
                key={JSON.stringify(record.outPoint)}
                onClick={onActionClick}
                tipBlockHash={tipBlockHash}
                tipBlockNumber={tipBlockNumber}
                epoch={epoch}
              />
            )
          })}
        </Stack>
      </>
    )
  }, [records, t, tipBlockHash, onActionClick, tipBlockNumber, epoch])

  let free = BigInt(0)
  let locked = BigInt(0)
  records.forEach(r => {
    if (!r.depositOutPoint) {
      locked += BigInt(r.capacity)
    } else {
      free += BigInt(r.capacity)
    }
  })

  const EpochInfo = useMemo(() => {
    if (!epoch) {
      return <Spinner />
    }
    const epochInfo = epochParser(epoch)
    return (
      <Stack tokens={{ childrenGap: 10 }}>
        <Text as="span" variant="small" block>{`Epoch number: ${epochInfo.number}`}</Text>
        <Text as="span" variant="small" block>{`Epoch index: ${epochInfo.index}`}</Text>
        <Text as="span" variant="small" block>{`Epoch length: ${epochInfo.length}`}</Text>
      </Stack>
    )
  }, [epoch])

  return (
    <>
      <Stack tokens={{ childrenGap: 15 }} horizontalAlign="stretch">
        <Text as="h1" variant="xxLarge">
          {wallet.name}
        </Text>
        <Stack horizontal tokens={{ childrenGap: 15 }}>
          <Stack style={{ minWidth: '250px' }} tokens={{ childrenGap: 10 }}>
            <Stack horizontalAlign="space-between" horizontal>
              <Text>{`${t('nervos-dao.free')}: `}</Text>
              <Text>{`${shannonToCKBFormatter(`${free}`)} CKB`}</Text>
            </Stack>
            <Stack horizontalAlign="space-between" horizontal>
              <Text>{`${t('nervos-dao.locked')}: `}</Text>
              <Text>{`${shannonToCKBFormatter(`${locked}`)} CKB`}</Text>
            </Stack>
          </Stack>
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 15 }}>
            <DefaultButton
              text={t('nervos-dao.deposit')}
              disabled={sending}
              onClick={() => setShowDepositDialog(true)}
            />
            <TooltipHost
              content={EpochInfo}
              styles={{ root: { display: 'flex', justifyContent: 'center', alignItems: 'center' } }}
            >
              <Icon iconName="info" />
            </TooltipHost>
          </Stack>
        </Stack>
        {Records}
      </Stack>
      <DepositDialog
        show={showDepositDialog}
        value={depositValue}
        fee={fee}
        onChange={(_e: any, value: string) => updateDepositValue(value)}
        onDismiss={onDepositDialogDismiss}
        onSubmit={onDepositDialogSubmit}
        onSlide={(value: number) => updateDepositValue(`${value}`)}
        balance={wallet.balance}
        isDepositing={sending}
        errorMessage={errorMessage}
      />
      {activeRecord ? (
        <WithdrawDialog
          record={activeRecord}
          onDismiss={onWithdrawDialogDismiss}
          onSubmit={onWithdrawDialogSubmit}
          tipBlockHash={tipBlockHash}
        />
      ) : null}
    </>
  )
}

NervosDAO.displayName = 'NervosDAOao'

export default NervosDAO
