import { createHash, randomBytes } from 'node:crypto';
import type { CaseTemplate, Difficulty, Evidence, Side } from '../shared/types.js';
import { CASES as OLD_CASES, publicCase as oldPublicCase } from './cases.js';
import { V3_PROFILE } from '../shared/rules.js';

// Each row records an actual observation, its useful inference, and its boundary separately.
type Row = [string, string, string, string, 'public' | Side, number, number, boolean, string?];
interface Spec { id: string; prefix: string; difficulty: Difficulty; title: string; hook: string; background: string; dispute: string; truth: string; charge: string; goal: string; slip: string; rows: Row[]; times: [string, string, string]; relations: [number, number, number, string][] }
const specs: Spec[] = [
  { id: 'pudding-004', prefix: 'B', difficulty: 'beginner', title: '公共冰箱里的布丁', hook: '公共冰箱，私人甜点，谁把便签贴歪了？',
    background: '午休后，公共冰箱里写着小圆名字的布丁只剩空杯。小豆承认吃过一杯，但说看见了“请分享”的便签。法庭要分清：这张便签究竟属于哪一杯。',
    dispute: '小豆吃的布丁是否属于共享食品？', truth: '小豆吃了小圆的私人布丁；共享便签原本贴在旁边的酸奶盒上，清洁时滑落到空杯旁。小豆没有得到吃私人布丁的许可。', charge: '证明小豆未经同意吃了小圆的私人布丁。', goal: '指出食品归属和便签位置的疑点，检验未经许可的指控是否充分。', slip: '布丁会晃，证词也会晃，所以责任应该先放回冰箱冷藏。', times: ['11:50', '12:20', '12:40'],
    rows: [
      ['冰箱门口记录', '12:20，小豆从冰箱取出一只布丁杯。', '小豆确实取过布丁。', '画面看不清杯身姓名，也不证明是否获准。', 'public', 18, .95, true],
      ['空杯旁的分享便签', '空布丁杯旁有一张写着“请分享”的纸条。', '现场出现了共享提示。', '纸条已脱落，位置不能确定原本贴在哪件食品上。', 'public', 12, .55, false, '纸条脱落，原始归属未固定'],
      ['同事的午休猜测', '同事说小豆“平时最爱吃布丁”。', '同事记得小豆的饮食偏好。', '喜好不能证明这一杯是谁的或是否获准。', 'public', 8, .4, false, '把饮食偏好当作本次行为证明'],
      ['共享食品约定', '冰箱门的约定允许大家取用贴有分享便签的食品。', '明确了哪些食品可自由取用。', '不能单独确定涉案布丁贴过分享便签。', 'defense', -16, .9, false],
      ['小圆的食品标签照片', '11:50，小圆拍到布丁杯写着自己的姓名。', '这杯布丁最初标为私人食品。', '照片不说明之后标签或授权有无变化。', 'prosecution', 18, .95, true],
      ['清洁时的物品摆放', '清洁员确认擦冰箱时挪动过酸奶盒和布丁杯。', '杯旁纸条的位置可能在清洁后改变。', '不能证明小豆看到的具体位置，也不能证明存在许可。', 'defense', -12, .85, false],
      ['便签背面的酸奶印', '便签背面的胶痕与酸奶盒的破口对应。', '共享便签原本来自酸奶盒。', '不能说明小豆是否有意误认；只说明便签归属。', 'prosecution', 20, .95, true],
    ], relations: [[1, 4, -7, '现场便签与共享约定说明许可需要核对食品归属，不能只看取杯动作。'], [5, 7, 8, '私人标签与便签胶痕共同说明布丁不属于共享食品。'], [2, 6, -6, '便签脱落且物品挪动过，现场相邻位置不足以还原原始标签。']] },
  { id: 'trophy-005', prefix: 'T', difficulty: 'beginner', title: '失踪的社团奖杯', hook: '奖杯没长腿，柜子却有两个。', background: '颁奖前，玻璃柜里的金色奖杯不见了。阿桂曾拿着奖杯离开活动室，坚称只是借去拍照。钥匙登记、归还消息与两只相似的柜子让事情没那么简单。', dispute: '阿桂拿走奖杯后是否拒不归还，还是归还到了别处？', truth: '阿桂借奖杯拍照后放进了旧储物柜，管理员只检查了展示柜；奖杯并未被私吞。', charge: '证明阿桂将奖杯据为己有，没有按约归还。', goal: '追查借用与归还链条，检验奖杯不在展示柜是否等于被私吞。', slip: '奖杯的杯口朝上，可见它也在举手申请无罪。', times: ['14:00', '14:30', '15:10'],
    rows: [
      ['活动室出入录像', '14:30，阿桂抱着奖杯离开活动室。', '阿桂曾经带走奖杯。', '不能单独证明借用不合法或后来没有归还。', 'public', 18, .95, true],
      ['空展示柜照片', '15:10，展示柜里没有奖杯。', '检查时展示位置是空的。', '照片没有拍摄旧储物柜。', 'public', 12, .55, false, '只检查了展示柜'],
      ['金色背包传闻', '同学说阿桂背包里“似乎闪着金光”。', '有人注意到背包反光。', '反光不能确定背包里装着奖杯。', 'public', 8, .35, false, '无法识别反光物体'],
      ['拍照借用登记', '14:00，社团登记同意阿桂借奖杯拍照。', '带走奖杯存在借用依据。', '借用登记本身不证明最终归还。', 'defense', -17, .95, true],
      ['归还时间约定', '登记要求在15:00前放回展示柜。', '归还存在明确时间与位置要求。', '违背放置要求不自动等于据为己有。', 'prosecution', 18, .9, false],
      ['旧柜存放照片', '14:55，阿桂发来的照片能辨认奖杯和旧柜的门牌。', '奖杯在截止时间前已放进旧柜。', '仍需核对实物与照片是否对应。', 'defense', -22, .95, true],
      ['钥匙未交回记录', '15:10，阿桂仍未交回展示柜钥匙。', '借用交接没有全部完成。', '钥匙在手不能证明奖杯也在手。', 'prosecution', 12, .9, false],
    ], relations: [[1, 4, -8, '录像中的带走行为有登记支持，不能直接当作私吞。'], [2, 6, -8, '空展示柜与旧柜照片可以同时成立，检查位置不同。'], [5, 7, 7, '归还位置和钥匙交接均未按约完成，支持管理责任方面的追问。']] },
  { id: 'projector-006', prefix: 'J', difficulty: 'beginner', title: '投影仪最后一次亮起', hook: '插头没有意见，接口先提出了抗议。', background: '社团投影仪在阿葵接上电脑后黑屏。机器原来就有一道旧裂纹，阿葵认为它早坏了。维修结果需要区分旧外壳裂纹与这次新损坏的接口。', dispute: '这次黑屏是否由阿葵的不当插接造成？', truth: '外壳裂纹是旧伤；阿葵将方向不匹配的转接头硬插，造成新的接口断裂并黑屏。', charge: '证明不当插接造成这次新故障。', goal: '区分旧伤、新损坏及实际原因，防止仅凭最后使用者认定责任。', slip: '既然屏幕是黑的，我方就主张在黑暗中一视同仁。', times: ['18:00', '18:12', '18:20'],
    rows: [
      ['最后一次插接录像', '18:12，阿葵接上转接头后机器黑屏。', '插接与黑屏先后相邻。', '时间接近不单独证明损坏原因。', 'public', 18, .95, true],
      ['旧外壳裂纹照片', '活动前照片显示外壳有裂纹。', '机器此前已有外观损伤。', '外壳裂纹与新接口故障不是同一处。', 'public', 12, .55, false, '将不同部位的损伤混为一谈'],
      ['同学的用力描述', '同学说听见阿葵嘀咕“怎么插不进去”。', '插接可能遇到了阻力。', '描述没有直接测量用力大小。', 'public', 8, .5, false, '转述没有直接测量损坏过程'],
      ['上周维修工单', '工单说明外壳裂纹尚未修复。', '旧伤确实存在。', '工单没有记载本次接口已经断裂。', 'defense', -16, .9, true],
      ['转接头方向检查', '带定位缺口的转接头与当时接口方向不符。', '存在不合适的插接方向。', '还需要确认接口实际损伤。', 'prosecution', 20, .95, true],
      ['插接前播放照片', '18:00，机器仍能正常显示社团标题。', '旧裂纹存在时机器仍能工作。', '不能独立排除之后的其他电路故障。', 'defense', -10, .85, false],
      ['接口断面检测', '18:20，接口发现新鲜折断痕迹，外壳裂纹边缘则已氧化。', '新断裂与旧裂纹可区分。', '检测仍需结合插接经过判断责任人。', 'prosecution', 22, .95, true],
    ], relations: [[2, 4, -7, '两份材料确认设备原有问题，需要先排除旧伤造成故障的解释。'], [1, 5, 8, '不匹配的转接头与紧接着发生的黑屏相互支持。'], [5, 7, 8, '方向不符与新鲜断面共同支持本次不当插接造成损坏。']] },
  { id: 'funds-007', prefix: 'F', difficulty: 'standard', title: '社团经费的零头', hook: '大账对上了，押金却绕了一个私人账户。', background: '社团支出表看起来有一大笔“神秘消费”。许账解释其中多数是采购与可退押金。争议集中在商家后来退回的280元究竟交给了谁。', dispute: '许账是否私自保留了应归社团的退款？', truth: '采购大部分真实；280元押金退入许账私人账户后，被用于私人餐费，没有交回社团。', charge: '证明280元退款属于社团且被许账私自使用。', goal: '核对原支出、退款归属和后续交接，避免把所有支出都认定为挪用。', slip: '既然账目最后有个零，我申请把责任也四舍五入成零。', times: ['09:00', '14:10', '18:00'],
    rows: [
      ['社团支出汇总', '经费表记录采购及押金共1280元。', '社团确有这笔支出。', '汇总不区分消费与可退押金。', 'public', 18, .95, true],
      ['聊天群的消费截图', '截图只显示“神秘消费1280”，备注被截断。', '有人对这笔支出提出疑问。', '缺少完整备注，不能还原交易性质。', 'public', 12, .5, false, '截图裁掉了押金备注'],
      ['同学的饭局传闻', '同学看到许账晚上请人吃饭。', '许账有私人消费。', '不能单独说明消费资金来自社团。', 'public', 8, .4, false, '没有资金来源对应'],
      ['采购货物验收单', '1000元采购的货物均已验收入库。', '多数支出对应真实货物。', '不能解释剩余押金退款。', 'defense', -17, .95, true],
      ['商家押金退款单', '商家14:10向许账退回280元押金。', '押金已退款给经办人。', '退款给经办人不自动证明被私用。', 'prosecution', 20, .95, true],
      ['临时垫付约定', '社团允许经办人临时垫款并统一报销。', '资金暂经私人账户可能有正常原因。', '约定要求实际垫款，不能覆盖任意私用。', 'defense', -16, .9, false],
      ['餐费付款记录', '18:00的私人餐费从退款所在账户扣付。', '退款后存在私人支出。', '单笔扣付还需结合账户余额与归还记录。', 'prosecution', 18, .95, true],
      ['未报销车费票据', '许账另有一张40元工作交通票据。', '他可能有少量待报销支出。', '金额与280元退款不相等。', 'defense', -8, .85, false],
      ['经费交接确认', '社团核对至当晚，没有收到280元归还，也没有批准冲抵。', '退款没有完成归还或合法冲抵。', '不能把这个结论扩大到全部采购支出。', 'prosecution', 18, .95, true],
    ], relations: [[1, 4, -7, '支出汇总中的1000元有实物验收支持，不能把总额全算作挪用。'], [5, 9, 8, '退款已到经办人账户且未归还，支持退款被保留的指控。'], [5, 7, 7, '退款与后续私人支付形成可继续核对的资金链。'], [6, 8, -6, '垫付约定和真实车费说明私人账户往来需要逐项核对。']] },
  { id: 'supplies-008', prefix: 'M', difficulty: 'standard', title: '少了两箱活动物资', hook: '仓库少两箱，分会场多了两次点名。', background: '活动结束，清单显示少了两箱灯串。负责搬运的小简被怀疑将物资带走。总仓与分会场各有一份清点表，箱子还被临时拆分过。', dispute: '物资真的少了两箱，还是清点和转运记录重复或遗漏？', truth: '小简把两箱灯串送到分会场并登记，回收时灯串合装到大箱；总仓沿用原箱数，误把包装变化当成物资失踪。', charge: '证明小简搬运后有实际物资缺失，且由其私自带走。', goal: '核对箱数与实物数量、转运和回收链条。', slip: '箱子是空心的，指控也可能是空心的，所以先让箱子自己作证。', times: ['10:00', '13:00', '20:00'],
    rows: [
      ['总仓发货清单', '10:00，总仓发出十箱灯串。', '记录了出仓包装数量。', '不等于回收时仍须使用十个相同箱子。', 'public', 18, .95, true],
      ['八箱回收照片', '20:00，回收区只有八个箱子。', '回收包装数少于出仓数。', '照片看不清箱内灯串数量。', 'public', 12, .55, false, '把包装数量当成实物数量'],
      ['私家车旁的背影', '一张远景照片拍到小简站在车旁。', '小简接近过车辆。', '看不清车里有无活动物资。', 'public', 8, .4, false, '远景无法识别车内物品'],
      ['分会场收货登记', '13:00，分会场登记收到小简送来的两箱灯串。', '两箱物资有正常去向。', '不能独立证明活动后的回收数量。', 'defense', -18, .95, true],
      ['搬运人签名', '十箱出仓单上有小简的签名。', '小简承担过搬运交接。', '签名不证明其独占整个保管过程。', 'prosecution', 18, .95, false],
      ['合箱回收备注', '回收人员注明把分会场灯串合装进两个较大的箱子。', '包装变化可以解释箱数减少。', '仍需核对灯串总数。', 'defense', -20, .9, false],
      ['临时通行记录', '小简的车曾获准进入后勤通道。', '具备运输条件。', '通行许可不记录实际装载。', 'prosecution', 10, .85, true],
      ['灯串逐件复核', '按编号复核，十箱原有的灯串均能在八箱中找到。', '包装变少但实物数量齐全。', '只针对本次灯串，不代表其他物资也齐全。', 'defense', -22, .95, true],
      ['交接未当面点数说明', '总仓接收时只数箱子，没有逐件开箱。', '当时交接程序存在缺口。', '程序缺口本身不证明被告偷走了物品。', 'prosecution', 10, .8, false],
    ], relations: [[1, 4, -7, '总仓出货与分会场收货能够解释转运去向。'], [2, 6, -8, '八箱照片与合箱备注并不冲突，箱数不能等同于物品数。'], [6, 8, -9, '合箱经过和编号复核共同说明没有实物短缺。'], [5, 9, 7, '经手签名与交接缺口支持追问保管程序，但不能独立证明盗取。']] },
  { id: 'account-009', prefix: 'A', difficulty: 'complex', title: '排位赛最后一局是谁打的', hook: '声音属于本人，鼠标可能不认声纹。', background: '小风赢下排位赛后被指控让阿渡代打。语音里一直能听到小风说话，但比赛设备、远程连接和前后两局操作记录存在差异。要核对的是最后一局的实际操作人。', dispute: '最后一局是否由小风本人操作，符合赛事参赛规则？', truth: '小风亲自打了前几局，最后一局由阿渡远程操作；小风仍在语音中说话，账号主人同意不等于符合赛事本人参赛规则。', charge: '证明最后一局由他人代操作，违反已公布的本人参赛要求。', goal: '区分语音、连接、旁观指导与实际操作，不把所有远程连接都认作代打。', slip: '鼠标有左右键，说明它也支持双方都有道理。', times: ['19:00', '20:05', '20:40'],
    rows: [
      ['最后一局设备记录', '20:05，比赛账号出现新的输入设备标识。', '输入来源发生变化。', '设备变化也可能来自重新连接，需要继续核对。', 'public', 18, .95, true],
      ['整晚语音片段', '录音中可以听到小风一直在讲话。', '小风参与了语音。', '说话不能单独证明正在操作鼠标键盘。', 'public', 12, .55, false, '把语音在线当成实际操作'],
      ['观众对手感的评价', '观众说最后一局“像换了个人”。', '表现存在主观差异。', '主观手感不能识别人。', 'public', 8, .4, false, '主观评价缺少身份验证'],
      ['前一局本机录像', '前一局录像显示小风本人操作。', '此前确实由本人参赛。', '录像不是被指控的最后一局。', 'defense', -16, .95, true],
      ['远程输入会话', '20:05，阿渡的会话取得输入控制权限。', '阿渡具备当时远程操作的能力。', '取得权限还需核对是否实际发送比赛输入。', 'prosecution', 20, .95, true],
      ['赛前远程指导约定', '赛前允许教练进行语音与屏幕指导。', '远程旁观本身并非违规。', '约定不允许教练接管输入。', 'defense', -14, .9, false],
      ['输入与比赛时间对应', '接管期间的输入时间与最后一局关键操作对应。', '远程输入与比赛操作存在关联。', '还需确认赛事对实际操作人的限制。', 'prosecution', 20, .95, true],
      ['断线重连记录', '当晚确有一次正常的本机断线重连。', '设备变化存在正常原因的可能。', '这次重连发生在前一局结束前。', 'defense', -10, .9, true],
      ['本人参赛规则', '报名时已确认不得把实际输入操作交给他人。', '账号主人同意不能替代本人操作要求。', '规则仍需与本次实际操作者对应。', 'prosecution', 18, .95, false],
      ['教练只读连接记录', '阿渡此前的一段连接为只读旁观。', '部分连接只是指导。', '只读时段不是最后一局的输入接管时段。', 'defense', -8, .85, true],
      ['接管确认消息', '小风发给阿渡“最后这把你来”，时间紧接最后一局。', '与输入接管形成相互支持的线索。', '消息必须结合输入记录，不能单靠口头玩笑认定。', 'prosecution', 20, .95, false],
    ], relations: [[2, 4, -6, '语音与此前录像提示需要按局次区分，不能把整晚一概视为代打。'], [5, 7, 8, '远程权限与实际输入时序相互印证。'], [7, 9, 8, '关键操作与本人参赛规则共同支持违规指控。'], [5, 11, 9, '接管会话与接管消息相互对应。'], [6, 10, -7, '允许指导且曾有只读连接，说明连接存在不等于代操作。']] },
  { id: 'assist-010', prefix: 'C', difficulty: 'complex', title: '比赛里的神奇准星', hook: '训练宏在电脑里，比赛按钮究竟有没有按？', background: '选手小准的回放出现极快转向。裁判在电脑上找到训练宏，却也看到比赛模式的限制记录。法庭需要区分“安装过工具”和“比赛中实际使用”。', dispute: '小准是否在本场比赛使用了禁止的自动瞄准辅助？', truth: '电脑安装过训练宏，但比赛模式禁用了它；回放的瞬间转向来自观战补帧，小准没有在比赛中使用自动瞄准。', charge: '证明禁止辅助在本场比赛实际运行并影响了操作。', goal: '核查运行状态、原始输入与观战画面的区别。', slip: '准星是个十字，所以我们应该先给它办一张医疗证明。', times: ['16:00', '16:30', '17:10'],
    rows: [
      ['训练宏安装记录', '电脑上装有自动转向训练宏。', '工具确实存在。', '安装不等于本场运行。', 'public', 18, .95, true],
      ['观战瞬间转向片段', '观战回放里准星突然转向。', '回放看起来存在异常动作。', '观战画面可能经过补帧。', 'public', 12, .55, true, '观战画面不是原始输入轨迹'],
      ['对手的神枪评价', '对手说小准“这准得不像人”。', '对手觉得操作异常。', '夸张评价不是工具运行证明。', 'public', 8, .4, false, '情绪性评价没有运行数据'],
      ['比赛模式限制记录', '比赛模式显示已禁用训练宏进程。', '工具在比赛中受到禁用限制。', '仍需核对记录覆盖的具体时段。', 'defense', -18, .95, true],
      ['训练宏功能说明', '该宏具备自动转向能力。', '如果运行，可能解释异常。', '功能说明不证明本场启用。', 'prosecution', 18, .9, false],
      ['原始鼠标输入轨迹', '关键时段的原始输入呈连续变化，没有回放中的瞬间跳转。', '原始输入与观战显示不同。', '只覆盖本次核对时段。', 'defense', -22, .95, true],
      ['比赛禁止工具条款', '规则禁止比赛中使用自动瞄准和自动转向。', '明确了违规标准。', '仍需证明实际使用。', 'prosecution', 12, .95, false],
      ['观战补帧说明', '服务器在丢帧后会合并显示多个转向动作。', '可解释观战瞬间跳转。', '机制说明要与本场丢帧记录对应。', 'defense', -14, .9, true],
      ['赛前宏快捷键设置', '赛前训练中为宏设置过快捷键。', '选手知道如何启动工具。', '设置不证明比赛中触发。', 'prosecution', 14, .9, true],
      ['关键时段丢帧记录', '异常片段对应观战客户端一次丢帧。', '补帧解释与本场时段对应。', '不能外推到所有比赛录像。', 'defense', -18, .95, true],
      ['赛后保留安装包', '赛后训练宏安装包仍在电脑上。', '工具没有被卸载。', '保存文件不等于运行进程。', 'prosecution', 8, .8, false],
    ], relations: [[1, 4, -8, '安装存在与比赛禁用可以同时成立，不能直接认定比赛中使用。'], [2, 6, -9, '观战与原始输入不一致，异常可能来自显示过程。'], [8, 10, -8, '补帧机制和本场丢帧对应，形成具体解释。'], [5, 9, 7, '功能与快捷键支持调查工具可用性，但仍不能单独证明本场运行。']] },
  { id: 'document-011', prefix: 'W', difficulty: 'complex', title: '报价文件最后的编辑者', hook: '最后保存的人，不一定改了最贵的那个数字。', background: '报价文件的总价被降低，版本页把阿宁列为最后编辑者，阿默则负责过报价内容。系统会自动同步格式，法庭需要找到实际修改价格的版本差异。', dispute: '阿默是否未经批准修改了报价，而非仅做格式同步？', truth: '阿默在未获批准时下调了报价，阿宁后来只同步格式；最后编辑者列表混合了内容修改与格式保存。', charge: '证明阿默实际修改价格且缺少必要批准。', goal: '区分内容修改、格式同步和编辑者归属，检验授权与实际操作。', slip: '文件有撤销键，我建议把刚才所有对我方不利的事情都按一次撤销。', times: ['09:10', '09:25', '09:40'],
    rows: [
      ['价格版本差异', '09:25的版本将报价从12万改为10万。', '价格确实发生改变。', '差异本身不说明操作者和授权。', 'public', 18, .95, true],
      ['最后编辑者列表', '09:40的文件页面显示阿宁最后保存。', '阿宁保存过后续版本。', '最后保存不等于修改价格。', 'public', 12, .55, true, '把最后保存归属当成价格修改归属'],
      ['办公室的降价传言', '有人说阿默一向喜欢“把价格做漂亮”。', '反映同事对阿默的印象。', '性格评价不能证明本次修改。', 'public', 8, .4, false, '印象替代本次操作记录'],
      ['格式同步任务', '09:40，阿宁账号运行了字体与表格同步。', '后续保存存在格式处理原因。', '不能说明09:25是谁改价。', 'defense', -16, .95, true],
      ['内容修改会话签名', '09:25价格编辑会话与阿默的已验证设备签名对应。', '把价格编辑关联到阿默设备。', '仍需排除共享会话或授权操作。', 'prosecution', 20, .95, true],
      ['市场建议讨论', '群里曾讨论过10万元方案。', '降价方案并非从未提出。', '讨论建议没有正式批准效力。', 'defense', -14, .9, false],
      ['报价审批规则', '最终报价改动必须由项目负责人签署批准。', '明确必要授权程序。', '规则不说明本次是否完成审批。', 'prosecution', 16, .95, false],
      ['共享文件夹访问表', '多人能打开该文件夹。', '访问机会并非阿默独有。', '能打开文件不等于拥有已验证编辑会话。', 'defense', -10, .9, true],
      ['审批流状态', '截止文件发送时，10万元方案仍为未批准。', '本次降价未走完批准程序。', '只针对这次方案，不代表所有修改都无授权。', 'prosecution', 20, .95, true],
      ['自动同步配置', '同步程序会更新格式，不会改动报价数字。', '格式保存与价格编辑可区分。', '不能单独识别09:25操作者。', 'defense', -10, .9, true],
      ['阿默的发送说明', '阿默在09:26称“数字已调好，先发再补签”。', '与价格编辑及未批准状态相互对应。', '需结合真实版本，不能仅凭措辞定案。', 'prosecution', 20, .95, false],
    ], relations: [[2, 4, -8, '最后保存记录可能来自格式同步，不足以认定价格修改者。'], [5, 9, 8, '内容会话与未批准状态共同支持未获准修改的指控。'], [5, 11, 9, '编辑会话和发送说明的时间彼此对应。'], [4, 10, -7, '格式任务与同步配置说明后续保存不应混同于报价编辑。']] },
  { id: 'parcel-012', prefix: 'K', difficulty: 'complex', title: '签收后的空盒子', hook: '签名很完整，包裹里的零件却少了一半。', background: '阿乔替实验室签收配件，交给前台后盒内被发现少了零件。商家发货、承运称重、签收及转交各有记录，争议在于短缺发生在哪一段。', dispute: '阿乔是否在签收后取走配件，还是包裹在此前就已少配？', truth: '商家发货时少装了配件，承运称重已显示较轻；阿乔签收后完整转交前台，没有取走零件。', charge: '证明配件在阿乔保管期间被其取走。', goal: '核对发货、重量、封口与交接，区分签收责任和短缺原因。', slip: '盒子里面是空的，因此里面也没有证据能指控我的当事人。', times: ['08:00', '11:20', '13:00'],
    rows: [
      ['阿乔签收记录', '11:20，阿乔在配件包裹上签名。', '阿乔接收过包裹。', '签收不证明当时盒内物品齐全。', 'public', 18, .95, true],
      ['开箱缺件照片', '13:00开箱时发现配件少了一半。', '开箱时存在短缺。', '照片无法确定短缺发生时间。', 'public', 12, .55, false, '仅凭开箱状态推断签收后被拿走'],
      ['走廊纸袋传言', '同学看见阿乔拿着一只纸袋离开。', '阿乔带走过纸袋。', '没有人看见袋内有涉案配件。', 'public', 8, .4, false, '未识别袋内物品'],
      ['前台转交登记', '11:25，前台登记接过阿乔送来的未开包裹。', '阿乔保管时间较短且有转交。', '登记仍需核对封口状态。', 'defense', -18, .95, true],
      ['阿乔的取件职责', '实验室由阿乔负责代收当天配件。', '阿乔负有代收交接职责。', '职责本身不证明取走物品。', 'prosecution', 16, .9, false],
      ['承运称重记录', '08:00的包裹重量与缺件后的重量接近。', '短缺可能在阿乔签收前已发生。', '称重需要核对秤误差和包裹编号。', 'defense', -22, .95, true],
      ['订单应发清单', '订单列明应有十件配件，实际只收到五件。', '应发与实收不符。', '清单不证明商家实际装了十件。', 'prosecution', 16, .95, false],
      ['封口连续照片', '签收和转交照片中的封口贴纸破纹位置相同。', '这段保管期间未见重新封口。', '完整封口不说明商家最初装箱数量。', 'defense', -16, .9, true],
      ['代收未当场清点说明', '阿乔没有拆箱逐件验收。', '代收检查不够完整。', '未验收与私自拿走是不同责任。', 'prosecution', 10, .9, false],
      ['商家装箱台记录', '装箱台复核发现当天同批订单漏装一袋配件。', '提供签收前少配的独立解释。', '仍需与本包裹编号对应。', 'defense', -20, .95, true],
      ['订单标签核对', '收货标签和实验室订单编号一致。', '收到的是本次订购的包裹。', '编号一致不证明包装内齐全。', 'prosecution', 10, .9, true],
    ], relations: [[1, 4, -7, '签收与五分钟后的转交说明保管链并未止于阿乔。'], [6, 8, -9, '早期重量和连续封口记录共同削弱签收后取件的推断。'], [6, 10, -9, '承运重量与装箱台漏装记录形成签收前短缺的解释。'], [5, 9, 7, '代收职责与未验收支持追问管理疏漏，不能直接替代盗取证明。']] },
];

const makeEvidence = (prefix: string, row: Row, index: number): Evidence => ({ id: `${prefix}${String(index + 1).padStart(2, '0')}`,
  title: row[0], description: row[1], supports: row[2], explanation: row[2], limitations: row[3], details: row[1],
  visibility: row[4], strength: row[5], reliability: row[6], technical: row[7], flaw: row[8] ?? null, linkedIds: [] });
const ownIds = (t: CaseTemplate, side: Side) => t.evidence.filter(e => e.visibility === side).map(e => e.id);
function enrich(t: CaseTemplate, difficulty: Difficulty): CaseTemplate {
  const evidence = t.evidence.map(e => ({ ...e, linkedIds: [...e.linkedIds] }));
  const negative = t.timelineRules!.find(r => r.delta < 0)!, positive = t.timelineRules!.find(r => r.delta > 0)!;
  for (const r of t.timelineRules!) for (const id of r.evidenceIds) {
    const e = evidence.find(e => e.id === id)!; e.linkedIds = [...new Set([...e.linkedIds, ...r.evidenceIds.filter(x => x !== id)])];
  }
  return { ...t, evidence, version: 5, engineVersion: 3, experienceVersion: 3, difficulty, ruleProfile: structuredClone(V3_PROFILE),
    charge: t.charge ?? `证明${t.dispute}`, defenseGoal: t.defenseGoal ?? `检验指控是否排除了现有证据允许的其他解释。`,
    comicSlip: t.comicSlip ?? `既然「${t.title}」还有疑问，我建议给疑问也安排一个被告席。`,
    timeline: t.timeline ?? evidence.filter(e => /\d{1,2}:\d{2}/.test(e.description)).map(e => ({ time: e.description.match(/\d{1,2}:\d{2}/)![0].padStart(5, '0'), text: e.description, evidenceIds: [e.id] })).sort((a, b) => a.time.localeCompare(b.time)),
    caseEvents: [
      { id: `${t.id}:discovery`, kind: 'discovery', title: `${t.title}：交接细节浮现`, branches: (['defense', 'prosecution'] as Side[]).map(side => ({ side, evidenceIds: [ownIds(t, side)[1]], targetEvidenceIds: [], explanation: '调查获得了另一份预置材料，仅调查者可见。' })) },
      { id: `${t.id}:contradiction`, kind: 'contradiction', title: `${t.title}：原有推断遇到另一条证据链`, branches: [
        { side: 'defense', evidenceIds: [...negative.evidenceIds], targetEvidenceIds: [negative.evidenceIds[0]], explanation: negative.explanation ?? '公开的两份材料揭示了原推断未考虑的限制，原有指控受到压力。' },
        { side: 'prosecution', evidenceIds: [...positive.evidenceIds], targetEvidenceIds: [negative.evidenceIds[1]], explanation: positive.explanation ?? '新的公开材料回应了辩护中尚未解释的部分，辩护论点受到压力。' },
      ] },
    ], allowedActions: [...t.allowedActions, 'investigate_lead', 'regain_composure'] };
}
const upgraded = OLD_CASES.map(t => {
  const copy = structuredClone(t); const difficulty: Difficulty = t.id === 'pizza-001' ? 'beginner' : 'standard';
  const descriptions: Record<string, string[]> = {
    'pizza-001': ['监控与开箱记录存在八分钟时差，不能直接据画面时间认定取件过程。', '校准后的开箱时间与事先送餐许可相互对应，支持获准取件的解释。', '订单与取件签名确认阿团从事务所领取了三块披萨，但仍需核对许可。'],
    'diamond-002': ['转移记录与自动操作计划可以同时成立，账号登录不能单独确定实际操作者。', '演练计划与事先许可的接收账户一致，支持测试转移属于获准工作。', '转移去向与接收账户权限对应，支持小闪有管理钻石去向的能力。'],
    'robot-003': ['写入时间与生效规则对应，余额变化存在执行规则的解释。', '结转规则与事先批准记录对应，支持获准工作的解释。', '写入记录与操作权限一致，确认机器人能够执行这次修改。', '写入记录与完成回执互相核对，确认修改由机器人执行。'],
  };
  copy.timelineRules = copy.timelineRules!.map((r, i) => ({ ...r, explanation: descriptions[t.id][i] }));
  copy.charge = t.id === 'pizza-001' ? '证明阿团未经许可取走事务所的三块披萨。' : t.id === 'diamond-002' ? '证明小闪未经许可把公共账户的虚拟钻石转出。' : '证明R-17未经批准修改老板的年假。';
  copy.defenseGoal = t.id === 'pizza-001' ? '核对身份、记录时间与取件许可，检验擅自取走的指控。' : t.id === 'diamond-002' ? '区分登录账号、实际操作与转移许可，检验私自转移的指控。' : '核对结转规则、批准记录与执行结果，检验越权修改的指控。';
  if (difficulty === 'standard') {
    const p = t.evidence[0].id[0];
    const extras: Row[] = p === 'D' ? [
      ['演练终端预约', '该共用终端当天预约用于测试演练。', '终端有测试用途。', '预约不能代替具体转移授权。', 'defense', -10, .9, true],
      ['接收账户维护回执', '转移后接收账户的维护操作使用小闪的有效权限。', '小闪能在转移后管理接收账户。', '事后维护不等于最初发起转移。', 'prosecution', 12, .9, true],
    ] : [
      ['界面缓存说明', '人事页面可能继续显示更新前的余额。', '旧截图与新记录可能来自不同更新时间。', '缓存机制本身不证明本次修改已获准。', 'defense', -10, .9, true],
      ['任务执行签名', '执行签名确认更新由R-17完成。', '写入者可以确认。', '执行身份不等于越权。', 'prosecution', 12, .95, true],
    ]; extras.forEach((row, i) => copy.evidence.push(makeEvidence(p, row, 7 + i)));
  }
  return enrich(copy, difficulty);
});
export const CASES_V3: CaseTemplate[] = [...upgraded, ...specs.map(s => {
  const evidence = s.rows.map((r, i) => makeEvidence(s.prefix, r, i));
  return enrich({ id: s.id, version: 5, title: s.title, subtitle: s.hook, background: s.background, dispute: s.dispute,
    truth: s.truth, review: `本案区分：${s.dispute}判决取决于本局实际建立的证据链，不等于预先宣布案件真相。`, charge: s.charge, defenseGoal: s.goal, comicSlip: s.slip,
    initialScore: s.difficulty === 'beginner' ? 42 : s.difficulty === 'standard' ? 46 : 48, threshold: s.difficulty === 'beginner' ? 60 : s.difficulty === 'standard' ? 62 : 64,
    evidence, rules: { presentMultiplier: 1, challengeBonus: 4, timelineBonus: 8, counterBonus: 5, crossBonus: 5 },
    timeline: evidence.filter(e => /\d{1,2}:\d{2}/.test(e.description)).map(e => ({ time: e.description.match(/\d{1,2}:\d{2}/)![0].padStart(5, '0'), text: e.description, evidenceIds: [e.id] })).sort((a, b) => a.time.localeCompare(b.time)),
    timelineRules: s.relations.map(([a, b, delta, explanation]) => ({ evidenceIds: [evidence[a - 1].id, evidence[b - 1].id], delta, explanation })),
    allowedActions: [...OLD_CASES[0].allowedActions] }, s.difficulty);
})];

export function instantiateCase(id: string, seed = randomBytes(12).toString('hex'), route?: 'route-a' | 'route-b'): CaseTemplate {
  const base = CASES_V3.find(t => t.id === id); if (!base) throw new Error('案件不存在');
  const t = structuredClone(base), selected = route ?? (parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 2), 16) % 2 ? 'route-b' : 'route-a');
  const initialPrivateIds = { defense: [] as string[], prosecution: [] as string[] }; t.leads = [];
  for (const side of ['defense', 'prosecution'] as Side[]) {
    const ids = ownIds(t, side), order = selected === 'route-a' ? ids : [ids[1], ids[0], ...ids.slice(2)];
    initialPrivateIds[side] = [order[0]];
    order.slice(1).forEach((id, i) => t.leads!.push({ id: `lead:${side}:${i + 1}`, side,
      label: i === 0 ? `核对${side === 'defense' ? '另一种解释' : '指控依据'}` : `追查第 ${i + 1} 个交接细节`,
      description: '沿已掌握材料追查下一份记录；调查所得仅你可见。', requiresIds: [order[i]], revealsIds: [id] }));
  }
  t.variant = { id: selected, seed, initialPrivateIds }; return deepFreeze(t);
}
export function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); } return value; }
export const publicCaseV3 = (t: CaseTemplate) => ({ ...oldPublicCase(t), difficulty: t.difficulty });
export function selectCase(difficulty: Difficulty, histories: string[][], entropy: number): string {
  const pool = CASES_V3.filter(t => t.difficulty === difficulty);
  for (let window = 3; window >= 0; window--) {
    const avoid = new Set(histories.flatMap(h => h.slice(0, window))), candidates = pool.filter(t => !avoid.has(t.id));
    if (candidates.length) return candidates[Math.abs(entropy) % candidates.length].id;
  }
  throw new Error('当前难度没有案件');
}
export function validateV3Cases(templates: readonly CaseTemplate[]) {
  const cases = new Set<string>(), globalIds = new Set<string>();
  for (const t of templates) {
    const bad = () => { throw new Error(`V1.3案件结构不完整：${t.id}`); };
    if (cases.has(t.id) || !t.difficulty || !t.charge || !t.defenseGoal || !t.truth || !t.comicSlip || t.caseEvents?.length !== 2) bad(); cases.add(t.id);
    const ids = new Set(t.evidence.map(e => e.id));
    if (ids.size !== t.evidence.length || t.evidence.length !== ({ beginner: 7, standard: 9, complex: 11 }[t.difficulty!])) bad();
    if (![t.initialScore, t.threshold].every(n => Number.isFinite(n) && n >= 0 && n <= 100) || !t.evidence.some(e => e.technical && e.visibility === 'public')) bad();
    for (const e of t.evidence) { if (globalIds.has(e.id) || !e.supports || !e.limitations || !Number.isFinite(e.strength) || e.reliability < 0 || e.reliability > 1 || e.linkedIds.some(id => !ids.has(id))) bad(); globalIds.add(e.id); }
    for (const node of t.timeline ?? []) if (!node.time || !node.text || !node.evidenceIds.length || node.evidenceIds.some(id => !ids.has(id))) bad();
    for (const r of t.timelineRules ?? []) if (r.evidenceIds.some(id => !ids.has(id)) || r.evidenceIds[0] === r.evidenceIds[1] || !Number.isFinite(r.delta)) bad();
    for (const rule of t.caseEvents ?? []) for (const b of rule.branches) if (![...b.evidenceIds, ...b.targetEvidenceIds].every(id => ids.has(id)) || !b.explanation) bad();
    for (const side of ['defense', 'prosecution'] as Side[]) if (ownIds(t, side).length < 2) bad();
  }
}
validateV3Cases(CASES_V3); deepFreeze(CASES_V3);
