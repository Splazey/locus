import { BaseNode, NODE_CONFIG } from './BaseNode'

export { NODE_CONFIG }

export const FileNode     = (props) => <BaseNode {...props} type="file" />
export const ClassNode    = (props) => <BaseNode {...props} type="class" />
export const FunctionNode = (props) => <BaseNode {...props} type="function" />
export const MethodNode   = (props) => <BaseNode {...props} type="method" />
export const ImportNode   = (props) => <BaseNode {...props} type="import" />

export const nodeTypes = {
  file:     FileNode,
  class:    ClassNode,
  function: FunctionNode,
  method:   MethodNode,
  import:   ImportNode,
}
