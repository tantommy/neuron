import { useEffect } from 'react'

import { NeuronWalletActions, StateDispatch, AppActions } from 'states/stateProvider/reducer'
import {
  toggleAddressBook,
  updateTransactionList,
  updateTransaction,
  updateCurrentWallet,
  updateWalletList,
  updateAddressList,
  initAppState,
} from 'states/stateProvider/actionCreators'

import { getWinID } from 'services/remote'
import {
  SystemScript as SystemScriptSubject,
  DataUpdate as DataUpdateSubject,
  NetworkList as NetworkListSubject,
  CurrentNetworkID as CurrentNetworkIDSubject,
  ConnectionStatus as ConnectionStatusSubject,
  SyncedBlockNumber as SyncedBlockNumberSubject,
  Command as CommandSubject,
} from 'services/subjects'
import { ckbCore, getTipBlockNumber, getBlockchainInfo } from 'services/chain'
import { Routes, ConnectionStatus } from 'utils/const'
import { WalletWizardPath } from 'components/WalletWizard'
import {
  networks as networksCache,
  currentNetworkID as currentNetworkIDCache,
  systemScript as systemScriptCache,
} from 'utils/localCache'

let timer: NodeJS.Timeout
const SYNC_INTERVAL_TIME = 10000

export const useSyncChainData = ({ chainURL, dispatch }: { chainURL: string; dispatch: StateDispatch }) => {
  useEffect(() => {
    const syncTipNumber = () =>
      getTipBlockNumber()
        .then(tipBlockNumber => {
          dispatch({
            type: AppActions.UpdateTipBlockNumber,
            payload: tipBlockNumber,
          })
        })
        .catch(console.error)

    const syncBlockchainInfo = () => {
      getBlockchainInfo()
        .then(info => {
          if (info) {
            const { chain = '', difficulty = '', epoch = '', alerts = [] } = info
            if (alerts.length) {
              alerts.forEach(a => {
                // TODO: display alerts in Notification
                console.info(a)
              })
            }
            dispatch({
              type: AppActions.UpdateChainInfo,
              payload: {
                chain,
                difficulty,
                epoch,
              },
            })
          }
        })
        .catch(console.error)
    }
    clearInterval(timer)
    if (chainURL) {
      ckbCore.setNode(chainURL)
      syncTipNumber()
      syncBlockchainInfo()
      timer = setInterval(() => {
        syncTipNumber()
        syncBlockchainInfo()
      }, SYNC_INTERVAL_TIME)
    } else {
      ckbCore.setNode('')
    }
    return () => {
      clearInterval(timer)
    }
  }, [chainURL, dispatch])
}

export const useOnCurrentWalletChange = ({
  walletID,
  history,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  i18n: any
  history: any

  dispatch: StateDispatch
}) => {
  useEffect(() => {
    if (walletID) {
      initAppState()(dispatch, history)
    } else {
      history.push(`${Routes.WalletWizard}${WalletWizardPath.Welcome}`)
      initAppState()(dispatch, history)
    }
  }, [walletID, dispatch, history])
}

export const useSubscription = ({
  walletID,
  chain,
  history,
  dispatch,
}: {
  walletID: string
  chain: State.Chain
  history: any
  dispatch: StateDispatch
}) => {
  const { pageNo, pageSize, keywords } = chain.transactions
  const { hash: txHash } = chain.transaction
  useEffect(() => {
    const systemScriptSubscription = SystemScriptSubject.subscribe(({ codeHash = '' }: { codeHash: string }) => {
      systemScriptCache.save({ codeHash })
      dispatch({
        type: NeuronWalletActions.UpdateCodeHash,
        payload: codeHash,
      })
    })
    const dataUpdateSubscription = DataUpdateSubject.subscribe(({ dataType, walletID: walletIDOfMessage }: any) => {
      if (walletIDOfMessage && walletIDOfMessage !== walletID) {
        return
      }
      switch (dataType) {
        case 'address': {
          updateAddressList(walletID)(dispatch)
          break
        }
        case 'transaction': {
          updateTransactionList({
            walletID,
            keywords,
            pageNo,
            pageSize,
          })(dispatch)
          updateTransaction({ walletID, hash: txHash })
          break
        }
        case 'wallet': {
          updateWalletList()(dispatch)
          updateCurrentWallet()(dispatch)
          break
        }
        default: {
          break
        }
      }
    })
    const networkListSubscription = NetworkListSubject.subscribe(({ currentNetworkList = [] }) => {
      dispatch({
        type: NeuronWalletActions.UpdateNetworkList,
        payload: currentNetworkList,
      })
      networksCache.save(currentNetworkList)
    })
    const currentNetworkIDSubscription = CurrentNetworkIDSubject.subscribe(({ currentNetworkID = '' }) => {
      dispatch({
        type: NeuronWalletActions.UpdateCurrentNetworkID,
        payload: currentNetworkID,
      })
      currentNetworkIDCache.save(currentNetworkID)
    })
    const connectionStatusSubscription = ConnectionStatusSubject.subscribe(status => {
      dispatch({
        type: NeuronWalletActions.UpdateConnectionStatus,
        payload: status ? ConnectionStatus.Online : ConnectionStatus.Offline,
      })
    })

    const syncedBlockNumberSubscription = SyncedBlockNumberSubject.subscribe(syncedBlockNumber => {
      dispatch({
        type: NeuronWalletActions.UpdateSyncedBlockNumber,
        payload: syncedBlockNumber,
      })
    })
    const commandSubscription = CommandSubject.subscribe(
      ({ winID, type, payload }: { winID: number; type: Command.Type; payload: Command.payload }) => {
        if (getWinID() === winID) {
          switch (type) {
            case 'nav': {
              history.push(payload)
              break
            }
            case 'toggleAddressBook': {
              dispatch(toggleAddressBook())
              break
            }
            case 'deleteWallet': {
              dispatch({
                type: AppActions.RequestPassword,
                payload: {
                  walletID: payload || '',
                  actionType: 'delete',
                },
              })
              break
            }
            case 'backupWallet': {
              dispatch({
                type: AppActions.RequestPassword,
                payload: {
                  walletID: payload || '',
                  actionType: 'backup',
                },
              })
              break
            }
            default: {
              break
            }
          }
        }
      }
    )
    return () => {
      systemScriptSubscription.unsubscribe()
      dataUpdateSubscription.unsubscribe()
      networkListSubscription.unsubscribe()
      currentNetworkIDSubscription.unsubscribe()
      connectionStatusSubscription.unsubscribe()
      syncedBlockNumberSubscription.unsubscribe()
      commandSubscription.unsubscribe()
    }
  }, [walletID, pageNo, pageSize, keywords, txHash, history, dispatch])
}

export default {
  useSyncChainData,
  useOnCurrentWalletChange,
  useSubscription,
}
